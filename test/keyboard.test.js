'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { newGame, disposeGame, boardMatchesDom } = require('./helpers/dom.js');

const sq = (name) => globalThis.Chess.fromAlgebraic(name);
const key = (name) => ({ key: name });

/** Press a key on the board grid, as a real keydown would. */
function press(game, name) {
  return game.boardUI.squaresEl.dispatch('keydown', key(name));
}

function startGame() {
  const harness = newGame();
  harness.game.start({ mode: 'human', baseSeconds: 0 });
  return harness;
}

test('the board grid is focusable and exposes grid semantics', () => {
  const { game } = startGame();
  try {
    const grid = game.boardUI.squaresEl;
    assert.equal(grid.getAttribute('role'), 'grid');
    assert.equal(grid.getAttribute('tabindex'), '0');
    assert.match(grid.getAttribute('aria-label'), /arrow keys/i);
    assert.equal(grid.getAttribute('aria-rowcount'), '8');

    const rows = grid.children;
    assert.equal(rows.length, 8, 'eight rows');
    for (const row of rows) {
      assert.equal(row.getAttribute('role'), 'row');
      assert.equal(row.children.length, 8, 'eight cells per row');
    }
    assert.equal(game.boardUI.piecesEl.getAttribute('aria-hidden'), 'true');
  } finally { disposeGame(game); }
});

test('each square is labelled with its name and occupant', () => {
  const { game } = startGame();
  try {
    const cells = game.boardUI.cells;
    assert.equal(cells[sq('e1')].getAttribute('aria-label'), 'e1, white king');
    assert.equal(cells[sq('d8')].getAttribute('aria-label'), 'd8, black queen');
    assert.equal(cells[sq('e4')].getAttribute('aria-label'), 'e4, empty');
    assert.equal(cells[sq('a2')].getAttribute('role'), 'gridcell');
  } finally { disposeGame(game); }
});

test('labels follow the position after a move', () => {
  const { game } = startGame();
  try {
    game._playMove('e4');
    assert.equal(game.boardUI.cells[sq('e4')].getAttribute('aria-label'), 'e4, white pawn');
    assert.equal(game.boardUI.cells[sq('e2')].getAttribute('aria-label'), 'e2, empty');
  } finally { disposeGame(game); }
});

test('focus places the cursor on the player king and tracks it', () => {
  const { game } = startGame();
  try {
    game.boardUI.squaresEl.dispatch('focus');
    assert.equal(game.boardUI.cursor, sq('e1'), 'starts on the white king');
    assert.equal(game.boardUI.squaresEl.getAttribute('aria-activedescendant'), 'sq-e1');
    assert.ok(game.boardUI.cells[sq('e1')].classList.contains('cursor'));
  } finally { disposeGame(game); }
});

test('arrow keys move the cursor and stop at the edges', () => {
  const { game } = startGame();
  try {
    const ui = game.boardUI;
    ui._setCursor(sq('e2'), { silent: true });

    press(game, 'ArrowUp');
    assert.equal(ui.cursor, sq('e3'), 'up is toward the opponent for white');
    press(game, 'ArrowRight');
    assert.equal(ui.cursor, sq('f3'));
    press(game, 'ArrowDown');
    assert.equal(ui.cursor, sq('f2'));
    press(game, 'ArrowLeft');
    assert.equal(ui.cursor, sq('e2'));

    ui._setCursor(sq('a1'), { silent: true });
    press(game, 'ArrowDown');
    press(game, 'ArrowLeft');
    assert.equal(ui.cursor, sq('a1'), 'clamped at the corner');

    press(game, 'End');
    assert.equal(ui.cursor, sq('h1'));
    press(game, 'Home');
    assert.equal(ui.cursor, sq('a1'));
  } finally { disposeGame(game); }
});

test('arrow directions follow a flipped board', () => {
  const { game } = startGame();
  try {
    const ui = game.boardUI;
    ui.setOrientation('b');
    ui._setCursor(sq('e7'), { silent: true });
    press(game, 'ArrowUp');
    assert.equal(ui.cursor, sq('e6'), 'up moves down the board when playing black');
    press(game, 'ArrowRight');
    assert.equal(ui.cursor, sq('d6'), 'right mirrors too');
  } finally { disposeGame(game); }
});

test('Enter selects a piece and Enter again plays the move', () => {
  const { game } = startGame();
  try {
    const ui = game.boardUI;
    ui._setCursor(sq('e2'), { silent: true });
    press(game, 'Enter');
    assert.equal(ui.selected, sq('e2'), 'the pawn is picked up');
    assert.ok(ui.legal.length > 0, 'its moves are known');

    ui._setCursor(sq('e4'), { silent: true });
    press(game, 'Enter');
    assert.equal(game.engine.history().join(''), 'e4', 'the move was played');
    assert.equal(ui.selected, null, 'selection is released');
    assert.equal(boardMatchesDom(game), null);
  } finally { disposeGame(game); }
});

test('Space works as an alternative to Enter', () => {
  const { game } = startGame();
  try {
    game.boardUI._setCursor(sq('d2'), { silent: true });
    press(game, ' ');
    assert.equal(game.boardUI.selected, sq('d2'));
    game.boardUI._setCursor(sq('d4'), { silent: true });
    press(game, ' ');
    assert.equal(game.engine.history().join(''), 'd4');
  } finally { disposeGame(game); }
});

test('Escape cancels a selection', () => {
  const { game } = startGame();
  try {
    game.boardUI._setCursor(sq('e2'), { silent: true });
    press(game, 'Enter');
    assert.equal(game.boardUI.selected, sq('e2'));
    press(game, 'Escape');
    assert.equal(game.boardUI.selected, null);
    assert.equal(game.engine.gameMoves.length, 0, 'no move was played');
  } finally { disposeGame(game); }
});

test('selecting an opponent piece is refused and explained', () => {
  const { game } = startGame();
  try {
    game.boardUI._setCursor(sq('e7'), { silent: true });
    press(game, 'Enter');
    assert.equal(game.boardUI.selected, null, 'black cannot be moved by white');
    assert.match(game.el.srStatus.textContent, /cannot move/i);
  } finally { disposeGame(game); }
});

test('moves are announced to the live region', () => {
  const { game } = startGame();
  try {
    assert.equal(game.el.srStatus.getAttribute('aria-live'), null,
      'the attribute lives in the markup, not the script');
    game._playMove('e4');
    assert.match(game.el.srStatus.textContent, /White plays e4/);

    game._playMove('d5');
    game._playMove('exd5');
    assert.match(game.el.srStatus.textContent, /capturing a pawn/);
  } finally { disposeGame(game); }
});

test('check and checkmate are announced', () => {
  const { game } = startGame();
  try {
    for (const san of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']) game._playMove(san);
    game._playMove('Qxf7');
    assert.match(game.el.srStatus.textContent, /Checkmate\. White wins\./);
  } finally { disposeGame(game); }
});

test('an identical announcement is still re-read', () => {
  const { game } = startGame();
  try {
    game.announce('Check.');
    const first = game.el.srStatus.textContent;
    game.announce('Check.');
    assert.notEqual(game.el.srStatus.textContent, first, 'content changes so it re-announces');
    assert.match(game.el.srStatus.textContent, /Check\./);
  } finally { disposeGame(game); }
});

test('the keyboard cannot move while reviewing an earlier position', () => {
  const { game } = startGame();
  try {
    game._playMove('e4');
    game._playMove('e5');
    game.navigate(0);                     // step back to the starting position
    assert.equal(game.boardUI.enabled, false, 'the board is locked while reviewing');

    game.boardUI._setCursor(sq('e2'), { silent: true });
    press(game, 'Enter');
    assert.equal(game.boardUI.selected, null, 'reviewing history blocks input');
    assert.match(game.el.srStatus.textContent, /not accepting moves/i);
    assert.equal(game.engine.gameMoves.length, 2, 'the game is unchanged');
  } finally { disposeGame(game); }
});

test('pointer selection keeps the keyboard cursor in step', () => {
  const { game } = startGame();
  try {
    game.boardUI._select(sq('g1'));
    game.boardUI._setCursor(sq('g1'), { silent: true });
    assert.equal(game.boardUI.cursor, sq('g1'));
    assert.ok(game.boardUI.cells[sq('g1')].classList.contains('cursor'));
  } finally { disposeGame(game); }
});
