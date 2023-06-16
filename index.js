const serialport = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const mqtt = require("mqtt");
const http = require("http");
const { Server } = require("socket.io");
const exec = require("child_process").exec;

require("dotenv").config();

const SerialPort = serialport.SerialPort;
const mqttHost = process.env.MQTT_BROKER;
const mqttPort = process.env.MQTT_PORT;
const serial = process.env.SERIAL_PORT;
const backendUrl = process.env.BACKEND_URL;
const serialNumber = process.env.SERIAL_NUMBER;
const serverPort = process.env.PORT || 4001;
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

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
});

const getSetting = async () => {
  await fetch(`${backendUrl}/public-node/setting/${serialNumber}`)
    .then((res) => res.json())
    .then((res) => (settings = res.settings));
};

const port = new SerialPort({ path: serial, baudRate: 9600 });
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
port.pipe(parser);

const checkInternetConnection = () => {
  http
    .get("http://www.google.com/images/icons/product/chrome-48.png", (res) => {
      isOnline = res.statusCode === 200;

      port.write(`${turnOnIndicator},0,${isOnline ? 1 : 0},*`);

      console.log(
        new Date().toLocaleString() + " : [NODEJS] Koneksi Internet:",
        isOnline
      );
    })
    .on("error", (err) => {
      isOnline = false;

      port.write(`0,0,0,*`);

      console.log(
        new Date().toLocaleString() + " : [NODEJS] Koneksi Internet Error:",
        err
      );
    });
};

let internetConnectionInterval;

internetConnectionInterval = setInterval(checkInternetConnection, 1000 * 60);

const mqttClient = mqtt.connect(`mqtt://${mqttHost}:${mqttPort}`);
const telemetryTopic = "EWS.telemetry";
const settingsTopic = "EWS.Settings." + serialNumber;

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
    turnOnBuzzer = response.tma_level === 3 && buzzerOff ? 1 : 0;
  } else if (tmaMode === tmaModes.reverse) {
    turnOnIndicator =
      response.tma_level === 4
        ? 0
        : response.tma_level === 1
        ? 3
        : response.tma_level === 3
        ? 1
        : 2;
    turnOnBuzzer = response.tma_level === 1 && buzzerOff ? 1 : 0;
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
    clearInterval(internetConnectionInterval);

    buzzerTimeout = setTimeout(() => {
      let command = `${turnOnIndicator},0,1,*`;

      port.write(command);

      timeoutIsTicking = false;

      clearTimeout(buzzerTimeout);

      internetConnectionInterval = setInterval(
        checkInternetConnection,
        60 * 1000
      );
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

parser.on("data", (data) => {});

port.on("open", async () => {
  console.log(new Date().toLocaleString() + " : [SERIAL PORT] Connected . . .");

  await getSetting();

  checkInternetConnection();
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
  mqttClient.subscribe([telemetryTopic, settingsTopic]);

  mqttClient.publish('request-setting', JSON.stringify({ serial_number: serialNumber }))

  sendActiveStatus(mqttClient);

  sendActiveStatusInterval = setInterval(() => {
    sendActiveStatus(mqttClient);
  }, 60000 * 5);
};

let sendActiveStatusInterval;

mqttClient.on("connect", () => {
  console.log(
    new Date().toLocaleString() + " : [MQTT] Connecting to MQTT Broker"
  );

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
    io.emit("telemetry", response);

    console.log(response);

    if (response.serial_number !== settings.iot_node) return;

    console.log("Response serial dan setting sama");

    if (!timeoutIsTicking) {
      telemetryCallback(response);
    }

    mqttClient.publish(
      `connection.${serialNumber}`,
      JSON.stringify({ response: "ok" })
    );
  } else if (topic === settingsTopic) {
    console.log(response);

    settingsCallback(response);
    mqttClient.publish(
      `connection.${serialNumber}`,
      JSON.stringify({ response: "ok" })
    );
  }
});

io.on("connection", (socket) => {
  console.log("New Client Connected");

  socket.on("disconnect", () => {
    console.log("Client Disconnected");
  });
});

server.listen(serverPort, () => {
  console.log(`Server berjalan di http://localhost:${serverPort}`);
});
