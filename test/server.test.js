import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { startServer } from '../server/index.js';

test('startServer falls back to an available port when the preferred port is busy', async () => {
  const occupiedServer = createHttpServer();
  await new Promise((resolve, reject) => {
    occupiedServer.once('error', reject);
    occupiedServer.listen(3000, '127.0.0.1', resolve);
  });

  try {
    const { httpServer, port } = await startServer({
      port: 3000,
      host: '127.0.0.1',
      maxPort: 3002,
    });

    assert.notStrictEqual(port, 3000);
    assert.ok(port >= 3001);

    await new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  } finally {
    await new Promise((resolve, reject) => {
      occupiedServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
