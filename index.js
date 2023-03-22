const serialport = require('serialport')
const { ReadlineParser } = require("@serialport/parser-readline");
const mqtt = require('mqtt')
const http = require('http')

require('dotenv').config()

const SerialPort = serialport.SerialPort
const mqttHost = process.env.MQTT_BROKER
const mqttPort = process.env.MQTT_PORT
const serial = process.env.SERIAL_PORT
const backendUrl = process.env.BACKEND_URL
const serialNumber = process.env.SERIAL_NUMBER

let isOnline = false
let settings = {}
let buzzerOff = true

const getSetting = () => {
    fetch(`${backendUrl}/public-node/setting/${serialNumber}`)
        .then(res => res.json())
        .then(res => settings = res.settings)
}

getSetting()

const port = new SerialPort({ path: serial, baudRate: 9600 })
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
port.pipe(parser)

port.write(`0,0,${isOnline ? 1 : 0},*`)

const checkInternetConnection = () => {
    http.get("http://www.google.com/images/icons/product/chrome-48.png", res => {
        isOnline = res.statusCode === 200

        port.write(`,,${isOnline ? 1 : 0},*`)

        console.log(new Date().toLocaleString() + " : [NODEJS] Koneksi Internet:", isOnline);
    }).on('error', err => {
        isOnline = false

        port.write(`,,0,*`)

        console.log(new Date().toLocaleString() + " : [NODEJS] Koneksi Internet Error:", err);
    })
}

checkInternetConnection()

setInterval(checkInternetConnection, 1000 * 60)

const mqttClient = mqtt.connect(`mqtt://${mqttHost}:${mqttPort}`)
const telemetryTopic = "EWS.telemetry"
const settingsTopic = "EWS.Settings." + serialNumber

let buzzerTimeout

const telemetryCallback = (response) => {
    console.log(`${new Date().toLocaleString()} : [MQTT] Status Siaga: ${response.tma_level}, Status Buzzer: ${response.tma_level === 1 ? 1 : 0}, Status Internet: ${isOnline ? 1 : 0}`);

    let command = `${response.tma_level},${(response.tma_level === 1 && buzzerOff) ? 1 : 0},1,*`

    port.write(command)

    buzzerOff = false;

    buzzerTimeout = setTimeout(() => {
        buzzerOff = true

        let command = `${response.tma_level},0,1,*`

        port.write(command)
    }, settings.timer_alarm * 1000);
}

const settingsCallback = (response) => {
    settings = response.settings

    clearTimeout(buzzerTimeout)

    buzzerOff = true

    buzzerTimeout = setTimeout(() => {
        buzzerOff = false
    }, settings.timer_alarm * 1000);
}

parser.on('data', data => {
    console.log(new Date().toLocaleString() + " : Data received from arduino:", data);
})

port.on('open', () => {
    console.log(new Date().toLocaleString() + " : [SERIAL PORT] Connected . . .");
})

port.on('close', () => {
    console.log(new Date().toLocaleString() + " : [SERIAL PORT] Disconnected . . .");
})

port.on('error', err => {
    console.log(new Date().toLocaleString() + " : [SERIAL PORT] Error:", err);

    port.end()
})

mqttClient.on("connect", () => {
    console.log(new Date().toLocaleString() + " : [MQTT] Connected to MQTT Broker");
    mqttClient.subscribe([telemetryTopic, settingsTopic])
})

mqttClient.on('error', err => {
    console.log(new Date().toLocaleString() + " : [MQTT] Error:", err);
})

mqttClient.on('close', () => {
    console.log(new Date().toLocaleString() + " : [MQTT] Closed");
})

mqttClient.on('disconnect', () => {
    console.log(new Date().toLocaleString() + " : [MQTT] Disconnected");
})
 
mqttClient.on('reconnect', () => {
    console.log(new Date().toLocaleString() + " : [MQTT] Reconnecting . . . ");
})

mqttClient.on('message', (topic, message) => {
    console.log(`${new Date().toLocaleString()} : [MQTT] Message received on topic: ${topic}`);

    let response = JSON.parse(message.toString())

    if (topic === telemetryTopic) {
        if (response.serial_number !== settings.iot_node) return

        telemetryCallback(response)
    } else if (topic === settingsTopic) {
        settingsCallback(response)
    }
})