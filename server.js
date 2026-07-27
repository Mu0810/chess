'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'onlinechess.me';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

// Clean URL -> file on disk. Anything not listed here is not a page.
const PAGES = {
  '/': 'index.html',
  '/about': 'about.html',
  '/contact': 'contact.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html'
};

// Pages that should appear in the sitemap, with their relative priority.
const SITEMAP = [
  ['/', '1.0', 'weekly'],
  ['/about', '0.8', 'monthly'],
  ['/contact', '0.6', 'yearly'],
  ['/privacy', '0.3', 'yearly'],
  ['/terms', '0.3', 'yearly']
];

const ASSET_PATTERN = /^(?:css|js)\/[A-Za-z0-9._-]+$/;
const ROOT_ASSETS = new Set(['og.png']);

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function securityHeaders(isSecure) {
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
  };
  if (isSecure) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

function send(res, status, body, headers, method) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, Object.assign({
    'Content-Length': payload.length,
    'Content-Type': 'text/plain; charset=utf-8'
  }, headers));
  res.end(method === 'HEAD' ? undefined : payload);
}

function redirect(res, location, method) {
  res.writeHead(301, { Location: location, 'Content-Length': 0, 'Cache-Control': 'no-cache' });
  res.end(method === 'HEAD' ? undefined : '');
}

/** Branded not-found page. Uses the site stylesheet, so no inline CSS. */
function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Page not found — onlinechess</title>
<meta name="robots" content="noindex" />
<link rel="stylesheet" href="/css/styles.css" />
</head>
<body class="page-body" data-theme="green">
  <main class="notfound">
    <div class="notfound-mark" aria-hidden="true">&#9822;</div>
    <h1>That page isn't here</h1>
    <p>The link may be out of date, or the piece moved.</p>
    <a class="btn-primary" href="/">Back to the board</a>
  </main>
</body>
</html>
`;
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: https://${CANONICAL_HOST}/sitemap.xml`,
    ''
  ].join('\n');
}

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = SITEMAP.map(([route, priority, frequency]) => [
    '  <url>',
    `    <loc>https://${CANONICAL_HOST}${route}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${frequency}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>'
  ].join('\n')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '';
}

function createServer() {
  return http.createServer((req, res) => {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' }, method);
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://placeholder');
    } catch (error) {
      send(res, 400, 'Bad Request', {}, method);
      return;
    }

    const hostHeader = String(req.headers.host || '');
    const hostname = hostHeader.split(':')[0].toLowerCase();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const behindProxy = forwardedProto !== '';
    const isSecure = forwardedProto === 'https';
    const local = isLocalHost(hostname);

    // Send every visitor to one canonical https origin. Local development and
    // direct (non-proxied) requests are left alone.
    if (!local && behindProxy && (!isSecure || hostname !== CANONICAL_HOST)) {
      redirect(res, `https://${CANONICAL_HOST}${url.pathname}${url.search}`, method);
      return;
    }

    const headers = securityHeaders(isSecure);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (error) {
      send(res, 400, 'Bad Request', headers, method);
      return;
    }

    // Generated files
    if (pathname === '/robots.txt') {
      send(res, 200, robotsTxt(), Object.assign({
        'Content-Type': MIME_TYPES['.txt'], 'Cache-Control': 'public, max-age=3600'
      }, headers), method);
      return;
    }
    if (pathname === '/sitemap.xml') {
      send(res, 200, sitemapXml(), Object.assign({
        'Content-Type': MIME_TYPES['.xml'], 'Cache-Control': 'public, max-age=3600'
      }, headers), method);
      return;
    }

    // Keep one URL per page: /about.html and /about/ both settle on /about.
    const htmlMatch = pathname.match(/^\/([a-z-]+)\.html$/);
    if (htmlMatch) {
      const clean = htmlMatch[1] === 'index' ? '/' : `/${htmlMatch[1]}`;
      if (PAGES[clean]) { redirect(res, clean + url.search, method); return; }
    }
    if (pathname.length > 1 && pathname.endsWith('/') && PAGES[pathname.slice(0, -1)]) {
      redirect(res, pathname.slice(0, -1) + url.search, method);
      return;
    }

    const relative = PAGES[pathname] || pathname.replace(/^\/+/, '');
    const isPage = Boolean(PAGES[pathname]);
    const isAsset = ROOT_ASSETS.has(relative) || ASSET_PATTERN.test(relative);

    if (!isPage && !isAsset) {
      send(res, 404, notFoundPage(), Object.assign({
        'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store'
      }, headers), method);
      return;
    }

    const filePath = path.resolve(ROOT, relative);
    if (!filePath.startsWith(ROOT + path.sep)) {
      send(res, 403, 'Forbidden', headers, method);
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        if (error.code === 'ENOENT') {
          send(res, 404, notFoundPage(), Object.assign({
            'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store'
          }, headers), method);
        } else {
          send(res, 500, 'Internal Server Error', headers, method);
        }
        return;
      }

      send(res, 200, contents, Object.assign({
        'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': isPage ? 'no-cache' : 'public, max-age=3600'
      }, headers), method);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`onlinechess listening on port ${port}`);
  });
}

module.exports = { createServer, CANONICAL_HOST };
