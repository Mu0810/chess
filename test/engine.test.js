'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/engine.js');
const Chess = globalThis.Chess;

test('perft matches published node counts', async (t) => {
  const positions = [
    ['initial position', Chess.START_FEN, [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]]
  ];
  for (const [name, fen, counts] of positions) {
    await t.test(name, () => {
      const game = new Chess(fen);
      counts.forEach((expected, i) => {
        assert.equal(game.perft(i + 1), expected, `depth ${i + 1}`);
      });
    });
  }
});

test('scholars mate produces correct SAN and detects checkmate', () => {
  const game = new Chess();
  const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7'];
  for (const san of sans) assert.ok(game.move(san), `${san} should be legal`);
  assert.equal(game.history().join(' '), 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#');
  assert.ok(game.isCheckmate());
  assert.deepEqual(game.status(), { over: true, reason: 'checkmate', winner: 'w' });
});

test('undo restores the exact previous FEN', () => {
  const game = new Chess();
  const before = game.fen();
  game.move('e4');
  assert.notEqual(game.fen(), before);
  game.undo();
  assert.equal(game.fen(), before);
});

test('castling moves both king and rook', () => {
  const game = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  game.move('O-O');
  assert.equal(game.get('g1').type, 'k');
  assert.equal(game.get('f1').type, 'r');
  assert.equal(game.get('e1'), null);
  assert.equal(game.get('h1'), null);

  game.move('O-O-O');
  assert.equal(game.get('c8').type, 'k');
  assert.equal(game.get('d8').type, 'r');
});

test('castling is rejected through check and after the king moves', () => {
  const throughCheck = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  throughCheck.move('Ke2');
  throughCheck.move('Ke7');
  assert.equal(throughCheck.move('O-O'), null, 'king has moved, castling illegal');

  const attacked = new Chess('4k1r1/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(attacked.move('O-O'), null, 'g1 is attacked, castling illegal');
});

test('en passant captures the passed pawn', () => {
  const game = new Chess('4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1');
  game.move('d4');
  const ep = game.move({ from: 'e4', to: 'd3' });
  assert.ok(ep, 'en passant should be legal');
  assert.ok(ep.enpassant);
  assert.equal(game.get('d4'), null, 'captured pawn is removed');
  assert.equal(game.get('d3').color, 'b');
});

test('promotion produces the requested piece', () => {
  for (const piece of ['q', 'r', 'b', 'n']) {
    const game = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const move = game.move({ from: 'a7', to: 'a8', promotion: piece });
    assert.ok(move, `promotion to ${piece}`);
    assert.equal(game.get('a8').type, piece);
  }
});

test('pinned pieces cannot move', () => {
  const game = new Chess('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
  const pinned = new Chess('4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1');
  assert.ok(game.moves().length > 0);
  const rookMoves = pinned.moves({ square: 'e2', verbose: true });
  assert.ok(rookMoves.every((m) => m.to.startsWith('e')), 'pinned rook stays on the e-file');
});

test('draw conditions are detected', async (t) => {
  await t.test('stalemate', () => {
    const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.ok(game.isStalemate());
    assert.equal(game.status().reason, 'stalemate');
  });

  await t.test('insufficient material', () => {
    assert.ok(new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1').insufficientMaterial(), 'K vs K');
    assert.ok(new Chess('4k3/8/8/8/8/8/8/3BK3 w - - 0 1').insufficientMaterial(), 'K+B vs K');
    assert.ok(!new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').insufficientMaterial(), 'a pawn can mate');
  });

  await t.test('fifty move rule', () => {
    const game = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 100');
    game.move('Ra2');
    assert.ok(game.isFiftyMove());
  });

  await t.test('threefold repetition', () => {
    const game = new Chess();
    for (let i = 0; i < 2; i++) {
      game.move('Nf3'); game.move('Nf6'); game.move('Ng1'); game.move('Ng8');
    }
    assert.ok(game.isThreefold(), 'starting position seen three times');
  });
});

test('FEN round-trips through load and export', () => {
  const fens = [
    Chess.START_FEN,
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 4',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
  ];
  for (const fen of fens) assert.equal(new Chess(fen).fen(), fen);
});

test('invalid FEN is rejected', () => {
  assert.throws(() => new Chess('not-a-fen'), /Invalid FEN/);
});

test('FEN loading rejects malformed fields without changing an existing game', () => {
  const game = new Chess();
  game.move('e4');
  const before = game.fen();
  const history = game.history();
  const placement = '4k3/8/8/8/8/8/8/4K3';
  const invalid = [
    '',
    null,
    `${placement} w - -`,
    `${placement} w - - 0 1 extra`,
    '9/8/8/8/8/8/8/4K2k w - - 0 1',
    '7/8/8/8/8/8/8/4K2k w - - 0 1',
    '8P/8/8/8/8/8/8/4K2k w - - 0 1',
    '4k3/8/8/8/8/8/8/4K2X w - - 0 1',
    `${placement} x - - 0 1`,
    `${placement} w KK - 0 1`,
    `${placement} w K- - 0 1`,
    `${placement} w - z6 0 1`,
    `${placement} w - e4 0 1`,
    `${placement} w - e3 0 1`,
    `${placement} w - - -1 1`,
    `${placement} w - - 1.5 1`,
    `${placement} w - - nope 1`,
    `${placement} w - - 0 0`,
    `${placement} w - - 0 9007199254740992`
  ];
  for (const fen of invalid) {
    assert.throws(() => game.load(fen), /Invalid FEN/);
    assert.equal(game.fen(), before);
    assert.deepEqual(game.history(), history);
    assert.equal(game.startFen, Chess.START_FEN);
  }
  game.undo();
  assert.equal(game.fen(), Chess.START_FEN, 'rejected loads retain the undo stack');
});

test('PGN export and import round-trip', () => {
  const game = new Chess();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) game.move(san);
  const pgn = game.pgn();
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);

  const loaded = new Chess();
  loaded.loadPgn(pgn);
  assert.equal(loaded.fen(), game.fen());
  assert.deepEqual(loaded.history(), game.history());
});

test('PGN import rejects an illegal move', () => {
  assert.throws(() => new Chess().loadPgn('1. e4 e5 2. Qh8'), /Illegal or unparsable/);
});

test('PGN import preserves recognized results, including unfinished games', () => {
  for (const result of ['1-0', '0-1', '1/2-1/2', '*']) {
    const game = new Chess();
    assert.equal(game.loadPgn(`[Result "${result}"]\n\n1. e4 e5 ${result}`), true);
    assert.deepEqual(game.history(), ['e4', 'e5']);
    assert.equal(game.pgnResult, result);
  }
  const headerOnly = new Chess();
  headerOnly.loadPgn('[Result "1-0"]\n\n1. e4 e5');
  assert.equal(headerOnly.pgnResult, '1-0');
  headerOnly.loadPgn('1. e4');
  assert.equal(headerOnly.pgnResult, null, 'a new import clears the previous result');
});

test('PGN import honors a custom starting FEN and retains it through moves and undo', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const game = new Chess();
  game.loadPgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 Kf7 *`);
  assert.equal(game.startFen, fen);
  assert.deepEqual(game.history(), ['e4', 'Kf7']);
  assert.equal(game.get('f7').type, 'k');
  game.undo();
  game.undo();
  assert.equal(game.fen(), fen);
  assert.equal(game.startFen, fen);
  game.reset();
  assert.equal(game.startFen, Chess.START_FEN);
  assert.equal(game.pgnResult, null);
});

test('PGN export numbers a black-to-move game from its initial fullmove number', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 17';
  const game = new Chess(fen);
  for (const move of ['Kf7', 'e4', 'Ke6']) assert.ok(game.move(move));
  assert.equal(game.pgn(), '17... Kf7 18. e4 Ke6');
  const imported = new Chess();
  imported.loadPgn(game.pgn({ SetUp: '1', FEN: game.startFen }) + ' *');
  assert.equal(imported.fen(), game.fen());
  assert.equal(imported.startFen, fen);
});

test('PGN import skips comments, annotations and nested variations', () => {
  const game = new Chess();
  game.loadPgn('1. e4! $1 {central pawn} (1. d4 (1... d5) 1... Nf6) e5; reply\n2. Nf3$2 Nc6 *');
  assert.deepEqual(game.history(), ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.equal(game.pgnResult, '*');
});

test('PGN comments cannot introduce metadata and quoted header punctuation is preserved', () => {
  const game = new Chess();
  game.loadPgn('[Event "Practice (rapid); round 1"]\n{Example: [Result "1-0"]}\n1. e4 e5 *');
  assert.deepEqual(game.history(), ['e4', 'e5']);
  assert.equal(game.pgnResult, '*');
});

test('invalid PGN keeps the existing game unchanged', () => {
  const game = new Chess();
  game.move('d4');
  const before = game.fen();
  const history = game.history();
  const invalid = [
    '1. e4 e5 2. Qh8',
    '1. e4 {unfinished',
    '1. e4 (1. d4',
    '1. e4 )',
    '[Event "unfinished]\n1. e4',
    '[Event unquoted]\n1. e4',
    '[SetUp "1"]\n1. e4',
    '[SetUp "2"]\n1. e4',
    '[Result "invalid"]\n1. e4',
    '[Result "1-0"]\n1. e4 0-1',
    '1. e4 * 1. d4 *',
    '[Event "first"]\n[Event "second"]\n1. e4'
  ];
  for (const text of invalid) {
    assert.throws(() => game.loadPgn(text), /Invalid PGN|Illegal or unparsable/);
    assert.equal(game.fen(), before);
    assert.deepEqual(game.history(), history);
    assert.equal(game.startFen, Chess.START_FEN);
    assert.equal(game.pgnResult, null);
  }
  assert.ok(game.undo(), 'failed imports preserve undo bookkeeping');
  assert.equal(game.fen(), Chess.START_FEN);
});

test('disambiguating SAN is generated when two pieces can reach a square', () => {
  // Both rooks have a clear path along the first rank to d1.
  const files = new Chess('4k3/8/8/8/4K3/8/8/R6R w - - 0 1');
  const sans = files.moves();
  assert.ok(sans.includes('Rad1'), `expected file disambiguation, got ${sans.join(',')}`);
  assert.ok(sans.includes('Rhd1'));

  // Same file, different ranks, so the rank is used instead.
  const ranks = new Chess('4k3/8/8/R7/4K3/8/8/R7 w - - 0 1');
  const rankSans = ranks.moves();
  assert.ok(rankSans.includes('R1a3'), `expected rank disambiguation, got ${rankSans.join(',')}`);
  assert.ok(rankSans.includes('R5a3'));
});

test('square helpers agree with algebraic notation', () => {
  assert.equal(Chess.toAlgebraic(0), 'a8');
  assert.equal(Chess.toAlgebraic(63), 'h1');
  assert.equal(Chess.fromAlgebraic('a8'), 0);
  assert.equal(Chess.fromAlgebraic('h1'), 63);
  assert.equal(Chess.squareColor(0), 'light');
});
