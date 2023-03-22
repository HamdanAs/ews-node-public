const serialport = require('serialport')
const { ReadlineParser } = require("@serialport/parser-readline");
const mqtt = require('mqtt')
const http = require('http')

let isOnline = false

const checkInternetConnection = () => {
    http.get("http://www.google.com/images/icons/product/chrome-48.png", res => {
        isOnline = res.statusCode === 200

        console.log(new Date().toLocaleString() + " : Koneksi Internet:", isOnline);
    }).on('error', () => {
        isOnline = false
    })
}

setInterval(checkInternetConnection, 1000 * 60)

const SerialPort = serialport.SerialPort

const port = new SerialPort({ path: '/dev/ttyUSB1', baudRate: 9600 })
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
port.pipe(parser)

const mqttClient = mqtt.connect("mqtt://193.168.195.119:1883")
const mqttTopic = "EWS.telemetry"

parser.on('data', data => {
    console.log(new Date().toLocaleString() + " : Data received from arduino:", data);
})

mqttClient.on("connect", () => {
    console.log(new Date().toLocaleString() + " : Connected to MQTT Broker");
    mqttClient.subscribe(mqttTopic)
})

mqttClient.on('error', err => {
    console.log(new Date().toLocaleString() + " : MQTT Error:", err);
})

mqttClient.on('close', () => {
    console.log(new Date().toLocaleString() + " : MQTT Closed");
})

mqttClient.on('disconnect', () => {
    console.log(new Date().toLocaleString() + " : MQTT Disconnected");
})

mqttClient.on('reconnect', () => {
    console.log(new Date().toLocaleString() + " : MQTT Reconnecting . . . ");
})

mqttClient.on('message', (topic, message) => {
    console.log(`${new Date().toLocaleString()} : Message received on topic: ${topic}`);

    let response = JSON.parse(message)

    let command = `${response.tma_level},${response.tma_level > 1 ? 1 : 0},${isOnline ? 1 : 0},*`

    port.write(command)
})