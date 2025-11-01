import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { exec } from 'child_process';

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

httpServer.listen(17331, () => console.log('[reload] WS listening on 17331'));

function broadcast(msg) {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}

// Watch build outputs; instruct pages to reload.
chokidar.watch('dist/{content.js,background.js,assets/popup.js,manifest.json}').on('change', (path) => {
  console.log('[reload] changed', path);
  broadcast({ type: 'RELOAD' });
});

// Optional: run vite build --watch for full cycle (user can start separately)
console.log('[reload] Ready. Run npm run build -- --watch in another terminal if needed.');