// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { insert, queryEvents } = require('./db');

const THRESHOLD = Number(process.env.THRESHOLD ?? 78);
console.log(`Threshold: ${THRESHOLD}`);

const handleData = (data) => {
  if (data.value > THRESHOLD) {
    insert.run(data.ts, data.value);
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'index.html');
    fs.readFile(htmlPath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(data);
    });
  } else if (url.pathname === '/api/events') {
    const minValue = url.searchParams.has('minValue') ? Number(url.searchParams.get('minValue')) : undefined;
    const maxValue = url.searchParams.has('maxValue') ? Number(url.searchParams.get('maxValue')) : undefined;
    const rows = queryEvents({ minValue, maxValue });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  } else if (url.pathname === '/api/threshold') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ threshold: THRESHOLD }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const io = new Server(server);

const startKafka = async () => {
  const { Kafka } = require('kafkajs');
  const kafka = new Kafka({ clientId: 'visualizer', brokers: ['localhost:9092'] });
  const consumer = kafka.consumer({ groupId: 'viz-group' });

  await consumer.connect();
  await consumer.subscribe({ topic: 'factory-data', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value.toString());
      handleData(data);
      io.emit('waveform-data', data);
    },
  });

  console.log('Kafka consumer started');
};

const startMock = () => {
  console.log('Kafka unavailable — using mock data (100ms interval)');
  setInterval(() => {
    const data = {
      ts: Date.now(),
      value: 40 + Math.sin(Date.now() / 1000) * 10 + (Math.random() - 0.5) * 2,
    };
    handleData(data);
    io.emit('waveform-data', data);
  }, 100);
};

if (require.main === module) {
  server.listen(3000, () => console.log('Server running at http://localhost:3000'));

  if (process.env.USE_MOCK === 'true') {
    startMock();
  } else {
    startKafka().catch(() => startMock());
  }
}

module.exports = { handleData, server };
