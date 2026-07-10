import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerHandlers } from './socket/handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Increase ping timeout for slow connections
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;
const CLIENT_PATH = path.join(__dirname, '..', 'client');

// Serve static files from the client directory
app.use(express.static(CLIENT_PATH));

// Fallback to index.html for all other routes (SPA-like)
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_PATH, 'index.html'));
});

// Register Socket.IO event handlers
registerHandlers(io);

import os from 'os';

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

httpServer.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║         Shadow Mafia — Ready              ║');
  console.log(`║  Local:   http://localhost:${String(PORT).padEnd(15)}║`);
  console.log(`║  Network: http://${localIp}:${String(PORT).padEnd(15 - localIp.length + 9)}║`);
  console.log('╚═══════════════════════════════════════════╝');
});
