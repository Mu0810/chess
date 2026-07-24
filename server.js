'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }, headers));
  res.end(body);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (_error) {
      send(res, 400, 'Bad Request');
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const isPublicAsset = relativePath === 'index.html' || /^(?:css|js)\/[A-Za-z0-9._-]+$/.test(relativePath);
    if (!isPublicAsset) {
      send(res, 404, 'Not Found');
      return;
    }

    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(ROOT + path.sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        send(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
        return;
      }

      const headers = {
        'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': contents.length,
        'Cache-Control': relativePath === 'index.html' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      };
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : contents);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Kiro Chess listening on port ${port}`);
  });
}

module.exports = { createServer };
