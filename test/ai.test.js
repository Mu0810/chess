'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/engine.js');
require('../js/ai.js');
const Chess = globalThis.Chess;
const ChessAI = globalThis.ChessAI;

const square = (idx) => Chess.toAlgebraic(idx);
const asMove = (m) => square(m.from) + square(m.to);

test('finds mate in one', () => {
  const ai = new ChessAI();
  const game = new Chess('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
  assert.equal(asMove(ai.chooseMove(game, 4)), 'a1a8');
});

test('captures a free piece', () => {
  const ai = new ChessAI();
  const game = new Chess('4k3/8/8/3r4/8/1B6/8/4K3 w - - 0 1');
  assert.equal(asMove(ai.chooseMove(game, 3)), 'b3d5');
});

test('avoids losing the queen for nothing', () => {
  const ai = new ChessAI();
  // The queen on d1 is attacked by nothing, but moving to d5 loses it to the pawn.
  const game = new Chess('4k3/2p5/8/8/8/8/8/3QK3 w - - 0 1');
  const chosen = asMove(ai.chooseMove(game, 3));
  assert.notEqual(chosen, 'd1d6', 'should not step next to the c7 pawn for free');
});

test('evaluation is symmetric and material aware', () => {
  const ai = new ChessAI();
  assert.equal(ai.evaluate(new Chess()), 0, 'the start position is balanced');
  const whiteUp = ai.evaluate(new Chess('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'));
  const blackUp = ai.evaluate(new Chess('3qk3/8/8/8/8/8/8/4K3 w - - 0 1'));
  assert.ok(whiteUp > 500, `white with a queen should score well, got ${whiteUp}`);
  assert.equal(whiteUp, -blackUp, 'mirrored positions score as opposites');
});

test('every difficulty returns a legal move', () => {
  const ai = new ChessAI();
  for (const level of [1, 2, 3, 4]) {
    const game = new Chess();
    const move = ai.chooseMove(game, level);
    assert.ok(move, `level ${level} produced a move`);
    assert.ok(game.move(move), `level ${level} move is legal`);
  }
});

test('returns null when there are no legal moves', () => {
  const ai = new ChessAI();
  const mated = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.ok(mated.isCheckmate(), 'position is checkmate');
  assert.equal(ai.chooseMove(mated, 2), null);
});

test('self-play produces only legal moves and terminates', () => {
  const ai = new ChessAI();
  const game = new Chess();
  let plies = 0;
  while (!game.isGameOver() && plies < 30) {
    const move = ai.chooseMove(game, plies % 2 === 0 ? 2 : 3);
    assert.ok(move, 'a move was found');
    assert.ok(game.move(move), `ply ${plies} move was legal`);
    plies++;
  }
  assert.equal(plies, 30);
  assert.equal(game.gameMoves.length, 30);
});

test('scores a queen promotion above every under-promotion', () => {
  // searchRoot is deterministic, unlike chooseMove which samples among
  // near-equal candidates to keep the lower levels human-like.
  const ai = new ChessAI();
  const game = new Chess('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
  const scores = {};
  for (const result of ai.searchRoot(game, 2, true)) {
    if (result.move.promotion) scores[result.move.promotion] = result.score;
  }
  assert.ok(scores.q > scores.r, `queen ${scores.q} should beat rook ${scores.r}`);
  assert.ok(scores.r > scores.b, `rook ${scores.r} should beat bishop ${scores.b}`);
  assert.ok(scores.q > scores.n, `queen ${scores.q} should beat knight ${scores.n}`);
});

test('chooseMove promotes to a queen when it promotes at all', () => {
  const ai = new ChessAI();
  for (let i = 0; i < 12; i++) {
    const game = new Chess('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
    const move = ai.chooseMove(game, 4);
    if (move.promotion) assert.equal(move.promotion, 'q', 'no pointless under-promotion');
  }
});
