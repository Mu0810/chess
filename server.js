'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
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

// Branded "not found" page so a wrong URL is still a way back into the game.
const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Page not found — Kiro Chess</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    background: radial-gradient(ellipse at 50% 30%, rgba(129,182,76,.16), transparent 60%), #131417;
    color: #f4f5f7; text-align: center; padding: 24px;
    font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .mark { font-size: 74px; line-height: 1; color: #81b64c; font-family: "Apple Symbols", "Arial Unicode MS", serif; }
  h1 { margin: 14px 0 6px; font-size: 26px; letter-spacing: -.5px; }
  p { margin: 0 0 22px; color: #a2a6b0; font-size: 15px; }
  a {
    display: inline-block; padding: 12px 22px; border-radius: 9px;
    background: linear-gradient(180deg, #94cb59, #5d8a33);
    color: #fff; font-weight: 700; text-decoration: none;
  }
  a:hover { filter: brightness(1.07); }
</style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">&#9822;</div>
    <h1>That page isn't here</h1>
    <p>The link may be out of date, or the piece moved.</p>
    <a href="/">Back to the board</a>
  </main>
</body>
</html>
`;

function sendNotFound(res, method) {
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(NOT_FOUND_PAGE),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE);
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
    const isPublicAsset = relativePath === 'index.html' || relativePath === 'og.png' ||
      /^(?:css|js)\/[A-Za-z0-9._-]+$/.test(relativePath);
    if (!isPublicAsset) {
      sendNotFound(res, req.method);
      return;
    }

    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(ROOT + path.sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        if (error.code === 'ENOENT') sendNotFound(res, req.method);
        else send(res, 500, 'Internal Server Error');
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
