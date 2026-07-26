'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../server.js');

/** Start the server on an ephemeral port for the duration of a test. */
function withServer(run) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', async () => {
      const request = (path, method = 'GET') => new Promise((ok, fail) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method }, (res) => {
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

test('serves the app shell', () => withServer(async (request) => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /id="board"/);
}));

test('serves css and js with correct content types', () => withServer(async (request) => {
  const css = await request('/css/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);

  const js = await request('/js/engine.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /text\/javascript/);
}));

test('serves the social card as a png', () => withServer(async (request) => {
  const res = await request('/og.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.body.subarray(1, 4).toString(), 'PNG');
}));

test('unknown paths return the branded 404 page', () => withServer(async (request) => {
  const res = await request('/no-such-page');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Back to the board/);
}));

test('runtime and dotfiles are not exposed', () => withServer(async (request) => {
  for (const path of ['/package.json', '/server.js', '/.gitignore', '/package-lock.json']) {
    const res = await request(path);
    assert.equal(res.status, 404, `${path} must not be served`);
    assert.doesNotMatch(res.text, /"dependencies"|createServer/, `${path} body must not leak source`);
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
    const res = await request('/', method);
    assert.equal(res.status, 405, `${method} should be rejected`);
    assert.equal(res.headers.allow, 'GET, HEAD');
  }
}));

test('HEAD returns headers without a body', () => withServer(async (request) => {
  const res = await request('/', 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.text, '');
}));

test('security and caching headers are present', () => withServer(async (request) => {
  const page = await request('/');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(page.headers['cache-control'], 'no-cache', 'the shell must revalidate');

  const asset = await request('/css/styles.css');
  assert.match(asset.headers['cache-control'], /max-age/);
}));
