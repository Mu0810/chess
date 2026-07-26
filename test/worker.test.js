'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { newGame, disposeGame } = require('./helpers/dom.js');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a game where the computer plays White, so it must move immediately. */
function aiToMove(opts) {
  const harness = newGame(opts);
  harness.game.start({ mode: 'ai', humanColor: 'b', aiLevel: 1, baseSeconds: 0 });
  return harness;
}

test('the worker script only depends on the engine and the search', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/worker.js'), 'utf8');
  assert.match(source, /importScripts\('engine\.js', 'ai\.js'\)/);
  assert.doesNotMatch(source, /\bdocument\b/, 'a worker has no DOM');
  assert.doesNotMatch(source, /\bwindow\b/, 'a worker has no window');
  for (const file of ['engine.js', 'ai.js']) {
    assert.ok(fs.existsSync(path.join(__dirname, '../js', file)), `${file} must exist`);
  }
});

test('search is delegated to the worker with the current position', () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    assert.equal(FakeWorker.instances.length, 1, 'one worker is created');
    assert.match(FakeWorker.instances[0].url, /worker\.js$/);

    const sent = FakeWorker.instances[0].posted;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'search');
    assert.equal(sent[0].fen, game.engine.fen(), 'the worker gets the live position');
    assert.equal(sent[0].level, 1);
    assert.equal(typeof sent[0].id, 'number');
    assert.equal(game.aiThinking, true, 'the thinking state is shown while it works');
  } finally { disposeGame(game); }
});

test('a worker result is played on the board', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    const worker = FakeWorker.instances[0];
    const id = worker.posted[0].id;
    const e2 = globalThis.Chess.fromAlgebraic('e2');
    const e4 = globalThis.Chess.fromAlgebraic('e4');

    game.aiStartedAt = performance.now() - 5000;   // skip the minimum think delay
    worker.reply({ type: 'result', id, move: { from: e2, to: e4 }, nodes: 1234 });
    await tick(5);

    assert.equal(game.engine.history().join(''), 'e4');
    assert.equal(game.aiThinking, false);
    assert.equal(game.ai.nodes, 1234, 'the reported node count is surfaced');
  } finally { disposeGame(game); }
});

test('a stale worker result is ignored', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    const worker = FakeWorker.instances[0];
    const staleId = worker.posted[0].id - 1;
    const e2 = globalThis.Chess.fromAlgebraic('e2');
    const e4 = globalThis.Chess.fromAlgebraic('e4');

    game.aiStartedAt = performance.now() - 5000;
    worker.reply({ type: 'result', id: staleId, move: { from: e2, to: e4 } });
    await tick(5);

    assert.equal(game.engine.gameMoves.length, 0, 'nothing was played');
  } finally { disposeGame(game); }
});

test('a result arriving after a new game does not leak into it', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    const worker = FakeWorker.instances[0];
    const id = worker.posted[0].id;

    // The user starts a fresh two-player game while the search is running.
    game.start({ mode: 'human', baseSeconds: 0 });
    const e2 = globalThis.Chess.fromAlgebraic('e2');
    const e4 = globalThis.Chess.fromAlgebraic('e4');
    game.aiStartedAt = performance.now() - 5000;
    worker.reply({ type: 'result', id, move: { from: e2, to: e4 } });
    await tick(5);

    assert.equal(game.engine.gameMoves.length, 0, 'the old search was discarded');
  } finally { disposeGame(game); }
});

test('a worker error falls back to the main thread and still moves', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    FakeWorker.instances[0].fail('worker blew up');
    await tick(120);

    assert.equal(game.workerUnavailable, true);
    assert.equal(game.worker, null, 'the broken worker is discarded');
    assert.equal(game.engine.gameMoves.length, 1, 'the computer still moved');
    assert.equal(game.aiThinking, false);
  } finally { disposeGame(game); }
});

test('a worker reporting an error falls back too', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    const worker = FakeWorker.instances[0];
    worker.reply({ type: 'result', id: worker.posted[0].id, error: 'search failed' });
    await tick(120);

    assert.equal(game.workerUnavailable, true);
    assert.equal(game.engine.gameMoves.length, 1, 'the computer still moved');
  } finally { disposeGame(game); }
});

test('an illegal worker reply is rejected and re-searched locally', async () => {
  const { game, FakeWorker } = aiToMove({ withWorker: true });
  try {
    const worker = FakeWorker.instances[0];
    const id = worker.posted[0].id;
    const a1 = globalThis.Chess.fromAlgebraic('a1');
    const a5 = globalThis.Chess.fromAlgebraic('a5');

    game.aiStartedAt = performance.now() - 5000;
    worker.reply({ type: 'result', id, move: { from: a1, to: a5 } });  // rook cannot jump the pawn
    await tick(120);

    assert.equal(game.engine.gameMoves.length, 1, 'a legal move was played instead');
    const played = game.engine.gameMoves[0];
    assert.ok(!(played.from === a1 && played.to === a5), 'not the illegal suggestion');
  } finally { disposeGame(game); }
});

test('without Worker support the search runs on the main thread', async () => {
  const { game } = aiToMove({ withWorker: false });
  try {
    assert.equal(game.workerUnavailable, true, 'no worker is available');
    await tick(120);
    assert.equal(game.engine.gameMoves.length, 1, 'the computer moved anyway');
    assert.equal(game.aiThinking, false);
  } finally { disposeGame(game); }
});

test('the computer does not move when it is the human turn', () => {
  const { game, FakeWorker } = newGame({ withWorker: true });
  try {
    game.start({ mode: 'ai', humanColor: 'w', aiLevel: 1, baseSeconds: 0 });
    assert.equal(FakeWorker.instances.length, 0, 'no search is started');
    assert.equal(game.aiThinking, false);
  } finally { disposeGame(game); }
});
