const serialport = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const mqtt = require("mqtt");

require("dotenv").config();

const SerialPort = serialport.SerialPort;
const mqttHost = process.env.MQTT_BROKER;
const mqttPort = process.env.MQTT_PORT;
const serial = process.env.SERIAL_PORT;
const backendUrl = process.env.BACKEND_URL;
const serialNumber = process.env.SERIAL_NUMBER;
const tmaMode = process.env.TMA_MODE || "NORMAL";
const baudRate = parseInt(process.env.BAUD_RATE);

console.log(backendUrl);

const tmaModes = {
  normal: "NORMAL",
  reverse: "REVERSE",
};

let isOnline = false;
let settings = {};
let buzzerOff = true;
let turnOnIndicator = 0;
let turnOnBuzzer = 0;
let buzzerTimeout;
let buzzerDelay;
let timeoutIsTicking = false;
let delayIsTicking = false;
let sendActiveStatusInterval;

const port = new SerialPort({ path: serial, baudRate: baudRate });
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
port.pipe(parser);

const mqttClient = mqtt.connect(`mqtt://${mqttHost}:${mqttPort}`);
const telemetryTopic = "EWS.telemetry";
const settingsTopic = "EWS.Settings." + serialNumber;
const connectionTopic = "EWS.Connection." + serialNumber;
const directSerialTopic = "EWS.DirectSerial." + serialNumber;

const telemetryCallback = (response) => {
  console.log(
    `${new Date().toLocaleString()} : [MQTT] Status Siaga: ${
      response.tma_level
    }, Status Buzzer: ${response.tma_level === 1 ? 1 : 0}, Status Internet: ${
      isOnline ? 1 : 0
    }`
  );
  console.log(
    `${new Date().toLocaleString()} : [MQTT] Timeout Buzzer Dimulai: ${timeoutIsTicking}`
  );
  console.log(
    `${new Date().toLocaleString()} : [MQTT] Delay Buzzer Dimulai: ${delayIsTicking}`
  );
  console.log(
    `${new Date().toLocaleString()} : [MQTT] Status Buzzer: ${
      buzzerOff ? "Sedang OFF" : "Sedang ON"
    }`
  );

  if (tmaMode === tmaModes.normal) {
    turnOnIndicator = response.tma_level === 4 ? 0 : response.tma_level;
    turnOnBuzzer = turnOnIndicator === 3 && buzzerOff ? 1 : 0;
  } else if (tmaMode === tmaModes.reverse) {
    turnOnIndicator =
      response.tma_level === 4
        ? 0
        : response.tma_level === 1
        ? 3
        : response.tma_level === 3
        ? 1
        : 2;
    turnOnBuzzer = turnOnIndicator === 1 && buzzerOff ? 1 : 0;
  }

  let command = `${turnOnIndicator},${turnOnBuzzer},1,*`;

  port.write(command);

  console.log(
    new Date().toLocaleString() + " : [DEBUG] Command Terkirim:",
    command
  );

  if (!timeoutIsTicking && turnOnBuzzer === 1) {
    buzzerOff = false;
    timeoutIsTicking = true;
    clearInterval(sendActiveStatusInterval)

    buzzerTimeout = setTimeout(() => {
      let command = `${turnOnIndicator},0,1,*`;

      port.write(command);

      timeoutIsTicking = false;

      clearTimeout(buzzerTimeout);

      sendActiveStatusInterval = setInterval(() => sendActiveStatus(mqttClient), 60000 * 20)
      
      turnOnBuzzer = 0;

    }, parseInt(settings.timer_alarm) * 1000);
  }

  if (!delayIsTicking && turnOnBuzzer === 1) {
    delayIsTicking = true;

    buzzerDelay = setTimeout(() => {
      buzzerOff = true;

      delayIsTicking = false;

      clearTimeout(buzzerDelay);
    }, settings.delay_alarm * 60000);
  }
};

const settingsCallback = (response) => {
  settings = response.settings;

  clearTimeout(buzzerTimeout);
  clearTimeout(buzzerDelay);

  buzzerOff = true;
};

port.on("open", () => {
  console.log(new Date().toLocaleString() + " : [SERIAL PORT] Connected . . .");
});

port.on("close", () => {
  console.log(
    new Date().toLocaleString() + " : [SERIAL PORT] Disconnected . . ."
  );
});

port.on("error", (err) => {
  console.log(new Date().toLocaleString() + " : [SERIAL PORT] Error:", err);

  port.end();
});

const sendActiveStatus = (client) => {
  client.publish(
    `connection.${serialNumber}`,
    JSON.stringify({ response: "ok" })
  );
};

const onConnected = () => {
  mqttClient.subscribe([telemetryTopic, settingsTopic, connectionTopic, directSerialTopic]);

  mqttClient.publish('request-setting', JSON.stringify({ serial_number: serialNumber }))

  sendActiveStatus(mqttClient)

  sendActiveStatusInterval = setInterval(() => {
    sendActiveStatus(mqttClient);
  }, 60000 * 20);
};

mqttClient.on("connect", () => {
  console.log(
    new Date().toLocaleString() + " : [MQTT] Connecting to MQTT Broker"
  );
  
  turnOnIndicator = 0;
  turnOnBuzzer = 0;
  
  onConnected();

  console.log(
    new Date().toLocaleString() + " : [MQTT] Connected to MQTT Broker"
  );
});

mqttClient.on("error", (err) => {
  console.log(new Date().toLocaleString() + " : [MQTT] Error:", err);
});

mqttClient.on("close", () => {
  console.log(new Date().toLocaleString() + " : [MQTT] Closed");
});

mqttClient.on("disconnect", () => {
  console.log(new Date().toLocaleString() + " : [MQTT] Disconnected");
});

mqttClient.on("reconnect", () => {
  console.log(new Date().toLocaleString() + " : [MQTT] Reconnecting . . . ");
});

mqttClient.on("message", (topic, message) => {
  console.log(
    `${new Date().toLocaleString()} : [MQTT] Message received on topic: ${topic}`
  );

  let response = JSON.parse(message.toString());

  if (topic === telemetryTopic) {
    console.log(response);

    if (response.serial_number !== settings.iot_node) return;

    console.log("Response serial dan setting sama");

    if (!timeoutIsTicking) {
      telemetryCallback(response);
    }

    sendActiveStatus(mqttClient)

  } else if (topic === settingsTopic) {
    console.log(response);

    settingsCallback(response);
    mqttClient.publish(
      `connection.${serialNumber}`,
      JSON.stringify({ response: "ok" })
    );
  } else if (topic === connectionTopic) {
    port.write(`${turnOnIndicator},${turnOnBuzzer},1,*`)
  } else if (topic === directSerialTopic) {
    console.log(response);
    port.write(`${response.status},${response.alarm},${response.internet},*`)
  }
});
