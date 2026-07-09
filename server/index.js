import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerHandlers } from './socket/handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createApp() {
  const app = express();
  const CLIENT_PATH = path.join(__dirname, '..', 'client');

  // Serve static files from the client directory
  app.use(express.static(CLIENT_PATH));

  // Fallback to index.html for all other routes (SPA-like)
  app.get('*', (req, res) => {
    res.sendFile(path.join(CLIENT_PATH, 'index.html'));
  });

  return app;
}

function listenWithRetry(httpServer, port, host, maxPort) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const tryListen = (currentPort) => {
      const onError = (error) => {
        if (settled) return;

        if (error.code === 'EADDRINUSE' && currentPort < maxPort) {
          httpServer.removeListener('error', onError);
          tryListen(currentPort + 1);
          return;
        }

        settled = true;
        reject(error);
      };

      httpServer.once('error', onError);
      httpServer.listen(currentPort, host, () => {
        if (settled) return;
        settled = true;
        httpServer.removeListener('error', onError);
        resolve(currentPort);
      });
    };

    tryListen(port);
  });
}

export async function startServer({ port = Number(process.env.PORT) || 3000, host = '0.0.0.0', maxPort = port + 10 } = {}) {
  const app = createApp();
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

  registerHandlers(io);

  const resolvedPort = await listenWithRetry(httpServer, port, host, maxPort);

  console.log('╔═══════════════════════════════════════════╗');
  console.log('║         Shadow Mafia — Ready              ║');
  console.log(`║  Server:  http://localhost:${resolvedPort}                ║`);
  console.log('║  Port:    ' + String(resolvedPort).padEnd(33) + '║');
  console.log('╚═══════════════════════════════════════════╝');

  return { app, httpServer, io, port: resolvedPort };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
