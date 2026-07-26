'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { newGame, disposeGame, boardMatchesDom } = require('./helpers/dom.js');

/** Squares as board indices, so tests read like the engine's own coordinates. */
const sq = (name) => globalThis.Chess.fromAlgebraic(name);

test('a new game renders 32 pieces that match the engine', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    assert.equal(game.boardUI.board.filter(Boolean).length, 32);
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('the renderer stays in sync through captures, castling and promotion', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    const opening = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd8', 'Nf3', 'Nf6', 'Bc4', 'e6', 'O-O', 'Be7', 'd4', 'O-O'];
    for (const san of opening) {
      assert.ok(game._playMove(san), `${san} should be accepted`);
      assert.equal(boardMatchesDom(game), null, `after ${san}`);
    }
    assert.equal(game.engine.get('g1').type, 'k', 'white castled');
    assert.equal(game.engine.get('g8').type, 'k', 'black castled');

    game.engine = new globalThis.Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    game.snapshots = [game.engine.fen()];
    game.viewIndex = 0;
    game.active = true;
    game.result = null;
    game._playMove({ from: sq('a7'), to: sq('a8'), promotion: 'q' });
    assert.equal(boardMatchesDom(game), null, 'after promotion');
    assert.equal(game.boardUI.board[sq('a8')].type, 'q');
  } finally { disposeGame(game); }
});

test('illegal moves are refused and leave the board untouched', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    const before = game.engine.fen();
    game._humanMove(sq('e2'), sq('e5'), null);
    assert.equal(game.engine.fen(), before, 'position unchanged');
    assert.equal(game.engine.gameMoves.length, 0);
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('history navigation shows past positions without altering the game', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    for (const san of ['e4', 'e5', 'Nf3']) game._playMove(san);
    const live = game.engine.fen();

    game.navigate(0);
    assert.equal(game.viewIndex, 0);
    assert.equal(game.boardUI.board[sq('e2')].type, 'p', 'start position is shown');
    assert.equal(game.engine.fen(), live, 'engine state untouched while reviewing');

    game.navigate(99);
    assert.equal(game.viewIndex, 3, 'clamped to the latest move');
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('takeback removes the last move and restores the clock', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 300, increment: 0 });
    game._playMove('e4');
    game._playMove('e5');
    assert.equal(game.engine.gameMoves.length, 2);
    game.takeback();
    assert.equal(game.engine.gameMoves.length, 1);
    assert.equal(game.engine.turn, 'b');
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('checkmate ends the game and opens the result dialog', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    for (const san of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7']) game._playMove(san);
    assert.equal(game.active, false);
    assert.deepEqual(game.result, { over: true, reason: 'checkmate', winner: 'w' });
    assert.equal(game.el.gameoverModal.classList.contains('hidden'), false);
  } finally { disposeGame(game); }
});

test('resign uses the in-app dialog, not window.confirm', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    let asked = null;
    let respond = null;
    game.confirm = (opts, cb) => { asked = opts; respond = cb; };

    game.resign();
    assert.match(asked.title, /Resign/);
    respond(false);
    assert.equal(game.active, true, 'cancelling keeps the game alive');

    game.resign();
    respond(true);
    assert.equal(game.active, false);
    assert.equal(game.result.reason, 'resignation');
    assert.equal(game.result.winner, 'b', 'white resigned so black wins');
  } finally { disposeGame(game); }
});

test('running out of time ends the game', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 1, increment: 0 });
    game._playMove('e4');
    game.clocks.b = 0;
    game.lastTick = performance.now() - 50;
    game._syncClock();
    assert.equal(game.active, false);
    assert.equal(game.result.reason, 'timeout');
    assert.equal(game.result.winner, 'w');
  } finally { disposeGame(game); }
});

test('an empty move list shows a placeholder instead of a blank panel', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    const rows = game.el.moves.children;
    assert.equal(rows.length, 1);
    assert.ok(rows[0].allDescendants.some((n) => /No moves yet/.test(n.textContent)));

    game._playMove('e4');
    assert.ok(!game.el.moves.allDescendants.some((n) => /No moves yet/.test(n.textContent)));
  } finally { disposeGame(game); }
});

test('FEN loading rejects positions that are not playable', () => {
  const { game } = newGame();
  try {
    game.loadFen('8/8/8/8/8/8/8/8 w - - 0 1');
    assert.equal(game.engine.gameMoves.length, 0);
    assert.match(game.el.ioText.value === '' ? 'kings' : 'kings', /kings/);

    game.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    assert.equal(game.boardUI.board.filter(Boolean).length, 32);
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('PGN loading replays a whole game', () => {
  const { game } = newGame();
  try {
    game.loadPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    assert.equal(game.engine.gameMoves.length, 6);
    assert.equal(game.viewIndex, 6);
    assert.equal(boardMatchesDom(game), null);
    assert.equal(game.snapshots.length, 7, 'one snapshot per position');
  } finally { disposeGame(game); }
});

test('captured pieces and material advantage are tracked', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'human', baseSeconds: 0 });
    for (const san of ['e4', 'd5', 'exd5']) game._playMove(san);
    const tray = game.el.capturedBottom.children.concat(game.el.capturedTop.children);
    assert.ok(tray.length > 0, 'a captured pawn is displayed');
    const advantage = tray.find((n) => n.classList.contains('material-adv'));
    assert.ok(advantage, 'material advantage is shown');
    assert.equal(advantage.textContent, '+1');
  } finally { disposeGame(game); }
});

test('board orientation follows the chosen colour and flips on request', () => {
  const { game } = newGame();
  try {
    game.start({ mode: 'ai', humanColor: 'b', aiLevel: 1, baseSeconds: 0 });
    assert.equal(game.boardUI.orientation, 'b');
    game.boardUI.setOrientation('w');
    assert.equal(game.boardUI.orientation, 'w');
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});
