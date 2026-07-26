/*
 * ai.js  -  Computer opponent.
 *
 * Negamax search with alpha-beta pruning, MVV-LVA move ordering, and a
 * quiescence search on the stronger levels. Evaluation combines material
 * with piece-square tables (Michniewski's simplified values, oriented so
 * index 0 == a8 to match the engine's board indexing).
 *
 * Difficulty levels choose search depth, whether quiescence is used, and a
 * "window" of centipawns within which the move is picked semi-randomly so
 * that lower levels play more human-like, beatable chess.
 */
(function (global) {
  'use strict';

  var VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  var MATE = 1000000;

  var PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ],
    kEnd: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10, 0, 0, -10, -20, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50
    ]
  };

  var LEVELS = {
    1: { depth: 2, quiesce: false, window: 110, noise: 45 },
    2: { depth: 3, quiesce: false, window: 55, noise: 18 },
    3: { depth: 4, quiesce: true, window: 20, noise: 0 },
    4: { depth: 4, quiesce: true, window: 0, noise: 0 }
  };

  var NODE_CAP = 500000; // safety valve so the browser never locks up

  function ChessAI() {
    this.nodes = 0;
  }

  ChessAI.prototype.evaluate = function (chess) {
    var board = chess.board;
    var score = 0, i, p;
    var nonPawn = 0;
    for (i = 0; i < 64; i++) {
      p = board[i];
      if (p && p.type !== 'p' && p.type !== 'k') nonPawn += VALUE[p.type];
    }
    var endgame = nonPawn <= 1300;
    for (i = 0; i < 64; i++) {
      p = board[i];
      if (!p) continue;
      var sq = p.color === 'w' ? i : (i ^ 56);
      var table = p.type === 'k' ? (endgame ? PST.kEnd : PST.k) : PST[p.type];
      var val = VALUE[p.type] + table[sq];
      score += p.color === 'w' ? val : -val;
    }
    return score;
  };

  ChessAI.prototype._evalStm = function (chess) {
    var s = this.evaluate(chess);
    return chess.turn === 'w' ? s : -s;
  };

  function orderMoves(moves) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var s = 0;
      if (m.capture) s += 10 * VALUE[m.capture] - VALUE[m.piece];
      if (m.promotion) s += VALUE[m.promotion];
      m._order = s;
    }
    moves.sort(function (a, b) { return b._order - a._order; });
    return moves;
  }

  ChessAI.prototype._quiesce = function (chess, alpha, beta) {
    this.nodes++;
    var standPat = this._evalStm(chess);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (this.nodes > NODE_CAP) return alpha;

    var moves = chess._legal(chess.turn);
    var caps = [];
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].capture || moves[i].promotion) caps.push(moves[i]);
    }
    orderMoves(caps);
    for (var j = 0; j < caps.length; j++) {
      chess._make(caps[j]);
      var v = -this._quiesce(chess, -beta, -alpha);
      chess._undo();
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };

  ChessAI.prototype._negamax = function (chess, depth, alpha, beta, ply, quiesce) {
    this.nodes++;
    var moves = chess._legal(chess.turn);
    if (moves.length === 0) {
      if (chess._kingAttacked(chess.turn)) return -(MATE - ply); // checkmated
      return 0; // stalemate
    }
    if (depth <= 0) {
      return quiesce ? this._quiesce(chess, alpha, beta) : this._evalStm(chess);
    }
    if (this.nodes > NODE_CAP) return this._evalStm(chess);

    orderMoves(moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      chess._make(moves[i]);
      var v = -this._negamax(chess, depth - 1, -beta, -alpha, ply + 1, quiesce);
      chess._undo();
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };

  /** Score every root move (full window so scores are comparable). */
  ChessAI.prototype.searchRoot = function (chess, depth, quiesce) {
    this.nodes = 0;
    var moves = chess._legal(chess.turn);
    orderMoves(moves);
    var results = [];
    for (var i = 0; i < moves.length; i++) {
      chess._make(moves[i]);
      var v = -this._negamax(chess, depth - 1, -Infinity, Infinity, 1, quiesce);
      chess._undo();
      results.push({ move: moves[i], score: v });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results;
  };

  /**
   * Choose a move for the side to move.
   * @returns {from, to, promotion} using board indices, or null if no move.
   */
  ChessAI.prototype.chooseMove = function (chess, level) {
    var cfg = LEVELS[level] || LEVELS[2];
    var results = this.searchRoot(chess, cfg.depth, cfg.quiesce);
    if (!results.length) return null;

    if (cfg.noise) {
      for (var i = 0; i < results.length; i++) {
        results[i].score += (Math.random() * 2 - 1) * cfg.noise;
      }
      results.sort(function (a, b) { return b.score - a.score; });
    }

    var best = results[0].score;
    var cands = results.filter(function (r) { return r.score >= best - cfg.window; });

    // Weighted pick: higher-scoring candidates are more likely.
    var minS = cands[cands.length - 1].score;
    var total = 0, weights = [];
    for (var k = 0; k < cands.length; k++) {
      var w = (cands[k].score - minS) + 1;
      weights.push(w);
      total += w;
    }
    var roll = Math.random() * total, acc = 0, chosen = cands[0];
    for (var j = 0; j < cands.length; j++) {
      acc += weights[j];
      if (roll <= acc) { chosen = cands[j]; break; }
    }

    var m = chosen.move;
    return { from: m.from, to: m.to, promotion: m.promotion || undefined };
  };

  global.ChessAI = ChessAI;
})(globalThis);
