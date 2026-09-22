/**
 * Winziger statischer Webserver ohne Abhaengigkeiten.
 *
 * Das Spiel besteht aus ES-Modulen. Die laedt kein Browser ueber file://,
 * deshalb braucht es einen Server - aber keinen grossen.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);

    // Nicht aus dem Projektordner herausreichen
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Verboten');
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || stat.isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(port, () => {
    console.log(`Sim Racing laeuft auf  http://localhost:${port}`);
    console.log('Im gleichen WLAN vom Handy aus erreichbar ueber die IP dieses Rechners.');
  });
