const serialport = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const http = require("http");

require("dotenv").config();

const SerialPort = serialport.SerialPort;
const serial = process.env.SERIAL_PORT;
const backendUrl = process.env.BACKEND_URL;
const serialNumber = process.env.SERIAL_NUMBER;

let isOnline = false;
let settings = {};
let buzzerOff = true;
let turnOnIndicator = 0;
let turnOnBuzzer = 0;

const getSetting = async () => {
  await fetch(`${backendUrl}/public-node/setting/${serialNumber}`)
    .then((res) => res.json())
    .then((res) => (settings = res.settings));
};

const port = new SerialPort({ path: serial, baudRate: 9600 });
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
port.pipe(parser);

port.write(`0,0,${isOnline ? 1 : 0},*`);

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

checkInternetConnection();

setInterval(checkInternetConnection, 1000 * 60);

let buzzerTimeout;
let buzzerDelay;
let timeoutIsTicking = false;
let delayIsTicking = false;
let loop = 1;

const telemetryCallback = () => {
  console.log(new Date().toLocaleString() + " : [TEST] Loop ke: " + loop);
  console.log(new Date().toLocaleString() + " : [TEST] ");
  turnOnIndicator = loop > 3 ? 0 : 3;
  turnOnBuzzer = turnOnIndicator === 3 && buzzerOff ? 1 : 0;

  let command = `${turnOnIndicator},${turnOnBuzzer},1,*`;

  port.write(command);

  buzzerOff = false;

  console.log(
    new Date().toLocaleString() + " : [TEST] Status Lampu: " + turnOnIndicator
  );
  console.log(
    new Date().toLocaleString() + " : [TEST] Status Buzzer: " + buzzerOff
      ? "Mati"
      : "Aktif"
  );

  if (!timeoutIsTicking) {
    timeoutIsTicking = true;

    buzzerTimeout = setTimeout(() => {
      let command = `${turnOnIndicator},0,1,*`;

      port.write(command);

      timeoutIsTicking = false;

      clearTimeout(buzzerTimeout);
    }, parseInt(settings.timer_alarm) * 1000);
  }

  if (!delayIsTicking && turnOnBuzzer === 1) {
    delayIsTicking = true;

    buzzerDelay = setTimeout(() => {
      buzzerOff = true;

      delayIsTicking = false;

      clearTimeout(buzzerDelay);

      loop++;
    }, settings.delay_alarm * 60000);
  }
};

parser.on("data", (data) => {
  console.log(
    new Date().toLocaleString() + " : [ARDUINO] Data received from arduino:",
    data
  );
});

port.on("open", async () => {
  console.log(new Date().toLocaleString() + " : [SERIAL PORT] Connected . . .");

  await getSetting();

  console.log(
    new Date().toLocaleString() + " : [TEST] Memulai Skema Pengetesan 1"
  );

  setInterval(telemetryCallback, 1000 * 60);
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
