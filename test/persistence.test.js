'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { newGame, disposeGame, boardMatchesDom } = require('./helpers/dom.js');

const SAVE_KEY = 'onlinechess-game';
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read whatever the app has written, parsed. */
const readSave = () => {
  const raw = globalThis.localStorage.getItem(SAVE_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** Build a controller as if the tab were reopened: storage is kept. */
const reopen = (opts = {}) => newGame({ keepStorage: true, ...opts });

test('a game in progress is written to storage', async () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 300, increment: 2 });
    game._playMove('e4');
    game._playMove('e5');
    await tick();

    const saved = readSave();
    assert.ok(saved, 'something was stored');
    assert.equal(saved.v, 1, 'the payload is versioned');
    assert.equal(saved.moves.length, 2);
    assert.equal(saved.config.baseSeconds, 300);
    assert.equal(saved.config.increment, 2);
    assert.equal(saved.clockHistory.length, 3, 'one clock entry per position');
  } finally { disposeGame(game); }
});

test('reopening restores the position, history and settings', async () => {
  // The worker is stubbed and never answers, so the computer does not move and
  // the search cannot block the debounced write.
  const first = newGame({ withWorker: true });
  try {
    first.game.start({ mode: 'ai', humanColor: 'b', aiLevel: 3, baseSeconds: 600 });
    for (const san of ['d4', 'd5', 'c4', 'e6']) first.game._playMove(san);
    await tick();
    var expectedFen = first.game.engine.fen();
    var expectedHistory = first.game.engine.history().join(' ');
  } finally { disposeGame(first.game); }

  const { game } = reopen({ withWorker: true });
  try {
    game._cancelAI();
    assert.equal(game.engine.fen(), expectedFen, 'same position');
    assert.equal(game.engine.history().join(' '), expectedHistory, 'same move list');
    assert.equal(game.config.mode, 'ai');
    assert.equal(game.config.humanColor, 'b');
    assert.equal(game.config.aiLevel, 3);
    assert.equal(game.snapshots.length, 5, 'snapshots rebuilt for navigation');
    assert.equal(boardMatchesDom(game), null, 'the board renders the restored position');
  } finally { disposeGame(game); }
});

test('restoring does not replay sounds or announcements', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 0 });
    first.game._playMove('e4');
    await tick();
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    const played = [];
    game.sounds.play = (name) => played.push(name);
    assert.equal(game.engine.gameMoves.length, 1, 'the move was restored');
    assert.deepEqual(played, [], 'no sounds fired during restore');
    assert.equal(game.el.srStatus.textContent, '', 'nothing was announced');
  } finally { disposeGame(game); }
});

test('the clock resumes stopped so time does not drain while closed', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 60 });
    first.game._playMove('e4');
    await tick();
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    assert.equal(game.clockRunning, false, 'the clock is paused after restoring');
    assert.ok(game.clocks.w > 0 && game.clocks.b > 0);
  } finally { disposeGame(game); }
});

test('a finished game restores as finished', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 0 });
    for (const san of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7']) first.game._playMove(san);
    await tick();
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    assert.equal(game.active, false);
    assert.equal(game.result.reason, 'checkmate');
    assert.equal(game.result.winner, 'w');
  } finally { disposeGame(game); }
});

test('starting a new game replaces the saved one', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 0 });
    for (const san of ['e4', 'e5', 'Nf3']) first.game._playMove(san);
    await tick();
    assert.equal(readSave().moves.length, 3);

    first.game.start({ mode: 'human', baseSeconds: 0 });
    await tick();
    const saved = readSave();
    assert.ok(!saved || saved.moves.length === 0, 'the fresh game has no moves to resume');
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    assert.equal(game.engine.gameMoves.length, 0, 'nothing is resumed');
  } finally { disposeGame(game); }
});

test('an empty game is not treated as resumable', () => {
  globalThis.localStorage.clear();
  const { game } = newGame();
  try {
    assert.equal(game.engine.gameMoves.length, 0);
    assert.equal(game.engine.fen(), globalThis.Chess.START_FEN);
  } finally { disposeGame(game); }
});

test('corrupt storage is discarded instead of breaking startup', () => {
  for (const payload of ['not json at all', '{}', '{"v":99,"moves":[]}', '{"v":1,"moves":"nope"}']) {
    globalThis.localStorage.setItem(SAVE_KEY, payload);
    const { game } = reopen();
    try {
      assert.equal(game.engine.gameMoves.length, 0, `recovered from ${payload}`);
      assert.equal(game.engine.fen(), globalThis.Chess.START_FEN);
    } finally { disposeGame(game); }
  }
});

test('a saved move that does not fit the position is rejected', () => {
  globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify({
    v: 1,
    startFen: globalThis.Chess.START_FEN,
    moves: [{ f: 0, t: 40 }],   // a8 rook cannot reach a3 from the start
    config: { mode: 'human', baseSeconds: 0 }
  }));
  const { game } = reopen();
  try {
    assert.equal(game.engine.gameMoves.length, 0, 'the bad save was dropped');
    assert.equal(globalThis.localStorage.getItem(SAVE_KEY), null, 'and cleared');
  } finally { disposeGame(game); }
});

test('promotions survive a save and restore', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 0 });
    first.game.loadFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    first.game._playMove({
      from: globalThis.Chess.fromAlgebraic('a7'),
      to: globalThis.Chess.fromAlgebraic('a8'),
      promotion: 'q'
    });
    await tick();
    assert.equal(readSave().moves[0].p, 'q', 'the promotion piece is stored');
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    assert.equal(game.engine.get('a8').type, 'q', 'restored as a queen');
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('board orientation is remembered', async () => {
  const first = newGame();
  try {
    first.game.start({ mode: 'human', baseSeconds: 0 });
    first.game._playMove('e4');
    first.game.boardUI.setOrientation('b');
    first.game._writeSave();
    assert.equal(readSave().orientation, 'b');
  } finally { disposeGame(first.game); }

  const { game } = reopen();
  try {
    assert.equal(game.boardUI.orientation, 'b');
  } finally { disposeGame(game); }
});

test('the app still works when storage throws', () => {
  globalThis.localStorage.clear();
  const { game } = newGame();
  try {
    game._writeSave = G_writeSaveThatThrows.bind(game);
    game.start({ mode: 'human', baseSeconds: 0 });
    game._playMove('e4');
    assert.equal(game.engine.history().join(''), 'e4', 'the game continues regardless');
  } finally { disposeGame(game); }
});

function G_writeSaveThatThrows() {
  throw new Error('storage is full');
}
