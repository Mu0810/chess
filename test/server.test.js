'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer, CANONICAL_HOST } = require('../server.js');

/** Start the server on an ephemeral port for the duration of a test. */
function withServer(run) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', async () => {
      const request = (path, options = {}) => new Promise((ok, fail) => {
        const req = http.request({
          host: '127.0.0.1',
          port: server.address().port,
          path,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            ok({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf8') });
          });
        });
        req.on('error', fail);
        req.end();
      });
      try {
        await run(request);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const PAGES = ['/', '/about', '/contact', '/privacy', '/terms'];

test('every page is served and carries the company name', () => withServer(async (request) => {
  for (const page of PAGES) {
    const res = await request(page);
    assert.equal(res.status, 200, `${page} should be served`);
    assert.match(res.headers['content-type'], /text\/html/, page);
    assert.match(res.text, /onlinechess/, `${page} must show the company name`);
  }
}));

test('the old product name is gone from every page', () => withServer(async (request) => {
  for (const page of PAGES) {
    const res = await request(page);
    assert.doesNotMatch(res.text, /Kiro/i, `${page} still mentions the old name`);
  }
}));

test('each page links to the legal and company pages', () => withServer(async (request) => {
  for (const page of PAGES) {
    const res = await request(page);
    for (const link of ['/about', '/contact', '/privacy', '/terms']) {
      assert.match(res.text, new RegExp(`href="${link}"`), `${page} should link to ${link}`);
    }
    assert.match(res.text, /&copy; 2026 onlinechess|© 2026 onlinechess/, `${page} needs a copyright line`);
  }
}));

test('the contact address appears on the company pages', () => withServer(async (request) => {
  for (const page of ['/about', '/contact', '/privacy', '/terms']) {
    const res = await request(page);
    assert.match(res.text, /manish@onlinechess\.me/, `${page} should show a contact address`);
  }
}));

test('pages declare a canonical url on the real domain', () => withServer(async (request) => {
  for (const page of PAGES) {
    const res = await request(page);
    assert.match(res.text, /rel="canonical" href="https:\/\/onlinechess\.me/, page);
    assert.doesNotMatch(res.text, /herokuapp\.com/, `${page} should not advertise the platform host`);
  }
}));

test('.html and trailing-slash urls settle on the clean path', () => withServer(async (request) => {
  const cases = [
    ['/about.html', '/about'],
    ['/privacy.html', '/privacy'],
    ['/index.html', '/'],
    ['/about/', '/about'],
    ['/terms/', '/terms']
  ];
  for (const [from, to] of cases) {
    const res = await request(from);
    assert.equal(res.status, 301, `${from} should redirect`);
    assert.equal(res.headers.location, to, `${from} -> ${to}`);
  }
}));

test('robots.txt points at the sitemap', () => withServer(async (request) => {
  const res = await request('/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.text, /User-agent: \*/);
  assert.match(res.text, new RegExp(`Sitemap: https://${CANONICAL_HOST}/sitemap.xml`));
}));

test('sitemap.xml lists every public page on the canonical host', () => withServer(async (request) => {
  const res = await request('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /xml/);
  for (const page of PAGES) {
    assert.match(res.text, new RegExp(`<loc>https://${CANONICAL_HOST}${page === '/' ? '/' : page}</loc>`), page);
  }
  assert.doesNotMatch(res.text, /herokuapp/);
}));

test('proxied http traffic is redirected to https on the canonical host', () => withServer(async (request) => {
  const res = await request('/about', {
    headers: { 'x-forwarded-proto': 'http', host: 'onlinechess.me' }
  });
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, 'https://onlinechess.me/about');
}));

test('other hostnames are redirected to the canonical domain', () => withServer(async (request) => {
  for (const host of ['onlinechess-655a99eaf495.herokuapp.com', 'www.onlinechess.me']) {
    const res = await request('/', { headers: { 'x-forwarded-proto': 'https', host } });
    assert.equal(res.status, 301, host);
    assert.equal(res.headers.location, 'https://onlinechess.me/', host);
  }
}));

test('a query string survives the redirect', () => withServer(async (request) => {
  const res = await request('/about?ref=aws', {
    headers: { 'x-forwarded-proto': 'http', host: 'www.onlinechess.me' }
  });
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, 'https://onlinechess.me/about?ref=aws');
}));

test('secure requests on the canonical host are served directly', () => withServer(async (request) => {
  const res = await request('/', {
    headers: { 'x-forwarded-proto': 'https', host: 'onlinechess.me' }
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['strict-transport-security'], /max-age=31536000/);
}));

test('local development is never redirected', () => withServer(async (request) => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['strict-transport-security'], undefined, 'no HSTS without https');
}));

test('security headers are set on every response', () => withServer(async (request) => {
  const res = await request('/');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.headers['content-security-policy'], /fonts\.googleapis\.com/);
  assert.match(res.headers['content-security-policy'], /worker-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(res.headers['permissions-policy'], /geolocation=\(\)/);
}));

test('static assets are served with the right type and caching', () => withServer(async (request) => {
  const css = await request('/css/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  assert.match(css.headers['cache-control'], /max-age/);

  const js = await request('/js/worker.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /text\/javascript/);

  const png = await request('/og.png');
  assert.equal(png.status, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal(png.body.subarray(1, 4).toString(), 'PNG');

  const page = await request('/');
  assert.equal(page.headers['cache-control'], 'no-cache', 'the shell must revalidate');
}));

test('unknown paths return the branded 404 page', () => withServer(async (request) => {
  const res = await request('/no-such-page');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /onlinechess/);
  assert.match(res.text, /Back to the board/);
  assert.match(res.text, /name="robots" content="noindex"/);
  assert.doesNotMatch(res.text, /<style/, 'the 404 page uses the site stylesheet');
}));

test('runtime files and dotfiles are not exposed', () => withServer(async (request) => {
  for (const path of ['/package.json', '/server.js', '/.gitignore', '/package-lock.json', '/README.md']) {
    const res = await request(path);
    assert.equal(res.status, 404, `${path} must not be served`);
    assert.doesNotMatch(res.text, /"dependencies"|createServer/, `${path} must not leak source`);
  }
}));

test('directory traversal is refused', () => withServer(async (request) => {
  for (const path of ['/../package.json', '/css/../../package.json', '/js/%2e%2e/%2e%2e/package.json']) {
    const res = await request(path);
    assert.ok(res.status === 403 || res.status === 404, `${path} gave ${res.status}`);
    assert.doesNotMatch(res.text, /"private": true/);
  }
}));

test('only GET and HEAD are allowed', () => withServer(async (request) => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await request('/', { method });
    assert.equal(res.status, 405, `${method} should be rejected`);
    assert.equal(res.headers.allow, 'GET, HEAD');
  }
}));

test('HEAD returns headers without a body', () => withServer(async (request) => {
  for (const path of ['/', '/about', '/robots.txt', '/missing']) {
    const res = await request(path, { method: 'HEAD' });
    assert.equal(res.text, '', `${path} must not send a body`);
  }
}));
