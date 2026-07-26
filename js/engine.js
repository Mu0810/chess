/*
 * engine.js  -  A complete, rules-accurate chess engine.
 *
 * Board indexing: 0..63, index 0 = a8 (top-left as White sees it),
 * index 63 = h1 (bottom-right). index = rank*8 + file where
 *   rank 0 == the 8th rank (top of the screen), rank 7 == the 1st rank
 *   file 0 == 'a', file 7 == 'h'.
 *
 * Pieces are stored as {type, color}. type is one of p n b r q k.
 * color is 'w' or 'b'. Empty squares are null.
 *
 * Implements: full legal move generation, castling, en passant, promotion,
 * check / checkmate / stalemate, draw by stalemate / 50-move / threefold
 * repetition / insufficient material, FEN import & export, SAN, and perft.
 */
(function (global) {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Movement offsets expressed as [deltaRank, deltaFile].
  var KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function rankOf(i) { return i >> 3; }
  function fileOf(i) { return i & 7; }
  function idx(r, c) { return r * 8 + c; }
  function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function squareColor(i) { return (rankOf(i) + fileOf(i)) % 2 === 0 ? 'light' : 'dark'; }

  function toAlgebraic(i) {
    return String.fromCharCode(97 + fileOf(i)) + (8 - rankOf(i));
  }
  function fromAlgebraic(s) {
    var c = s.charCodeAt(0) - 97;
    var r = 8 - parseInt(s.charAt(1), 10);
    return idx(r, c);
  }
  function other(color) { return color === 'w' ? 'b' : 'w'; }

  function Chess(fen) {
    this.board = new Array(64).fill(null);
    this.turn = 'w';
    this.castling = { K: false, Q: false, k: false, q: false };
    this.ep = -1;          // en-passant target square index, or -1
    this.halfmove = 0;     // half-move clock for the 50-move rule
    this.fullmove = 1;

    this._undoStack = [];  // internal make/unmake bookkeeping
    this._movesStack = [];
    this.gameMoves = [];   // moves actually played (for history / takeback)
    this._posCounts = {};  // repetition counts keyed by position
    this._keyStack = [];   // aligned with gameMoves

    this.load(fen || START_FEN);
  }

  Chess.START_FEN = START_FEN;
  Chess.toAlgebraic = toAlgebraic;
  Chess.fromAlgebraic = fromAlgebraic;
  Chess.fileOf = fileOf;
  Chess.rankOf = rankOf;
  Chess.squareColor = squareColor;

  var P = Chess.prototype;

  // ---- Loading / exporting -------------------------------------------------

  P.load = function (fen) {
    var parts = fen.trim().split(/\s+/);
    var placement = parts[0];
    var rows = placement.split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN: bad rank count');

    this.board = new Array(64).fill(null);
    for (var r = 0; r < 8; r++) {
      var row = rows[r];
      var c = 0;
      for (var k = 0; k < row.length; k++) {
        var ch = row.charAt(k);
        if (/[1-8]/.test(ch)) {
          c += parseInt(ch, 10);
        } else {
          var color = ch === ch.toUpperCase() ? 'w' : 'b';
          this.board[idx(r, c)] = { type: ch.toLowerCase(), color: color };
          c++;
        }
      }
    }

    this.turn = (parts[1] === 'b') ? 'b' : 'w';

    var cast = parts[2] || '-';
    this.castling = {
      K: cast.indexOf('K') !== -1,
      Q: cast.indexOf('Q') !== -1,
      k: cast.indexOf('k') !== -1,
      q: cast.indexOf('q') !== -1
    };

    this.ep = (parts[3] && parts[3] !== '-') ? fromAlgebraic(parts[3]) : -1;
    this.halfmove = parts[4] ? parseInt(parts[4], 10) : 0;
    this.fullmove = parts[5] ? parseInt(parts[5], 10) : 1;

    this._undoStack = [];
    this._movesStack = [];
    this.gameMoves = [];
    this._posCounts = {};
    this._keyStack = [];
    var key = this._positionKey();
    this._posCounts[key] = 1;
  };

  P.reset = function () { this.load(START_FEN); };

  P.fen = function () {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var empty = 0, row = '';
      for (var c = 0; c < 8; c++) {
        var p = this.board[idx(r, c)];
        if (!p) { empty++; }
        else {
          if (empty) { row += empty; empty = 0; }
          row += (p.color === 'w') ? p.type.toUpperCase() : p.type;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    var cast = (this.castling.K ? 'K' : '') + (this.castling.Q ? 'Q' : '') +
      (this.castling.k ? 'k' : '') + (this.castling.q ? 'q' : '');
    if (!cast) cast = '-';
    var ep = this.ep >= 0 ? toAlgebraic(this.ep) : '-';
    return rows.join('/') + ' ' + this.turn + ' ' + cast + ' ' + ep +
      ' ' + this.halfmove + ' ' + this.fullmove;
  };

  P._positionKey = function () {
    // Placement + side + castling + ep only (enough for repetition).
    var s = '';
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      s += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
    }
    var cast = (this.castling.K ? 'K' : '') + (this.castling.Q ? 'Q' : '') +
      (this.castling.k ? 'k' : '') + (this.castling.q ? 'q' : '');
    return s + ' ' + this.turn + ' ' + cast + ' ' + this.ep;
  };

  // ---- Basic accessors -----------------------------------------------------

  P.get = function (square) {
    var i = typeof square === 'number' ? square : fromAlgebraic(square);
    return this.board[i];
  };
  P.turnColor = function () { return this.turn; };

  P._findKing = function (color) {
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (p && p.type === 'k' && p.color === color) return i;
    }
    return -1;
  };

  // ---- Attack detection ----------------------------------------------------

  P.isSquareAttacked = function (i, by) {
    var r = rankOf(i), c = fileOf(i), rr, cc, p, d;

    // Pawn attackers sit one rank toward their own side.
    var pdir = (by === 'w') ? 1 : -1;
    for (var dc = -1; dc <= 1; dc += 2) {
      rr = r + pdir; cc = c + dc;
      if (onBoard(rr, cc)) {
        p = this.board[idx(rr, cc)];
        if (p && p.color === by && p.type === 'p') return true;
      }
    }
    // Knights
    for (d = 0; d < KNIGHT.length; d++) {
      rr = r + KNIGHT[d][0]; cc = c + KNIGHT[d][1];
      if (onBoard(rr, cc)) {
        p = this.board[idx(rr, cc)];
        if (p && p.color === by && p.type === 'n') return true;
      }
    }
    // King
    for (d = 0; d < KING.length; d++) {
      rr = r + KING[d][0]; cc = c + KING[d][1];
      if (onBoard(rr, cc)) {
        p = this.board[idx(rr, cc)];
        if (p && p.color === by && p.type === 'k') return true;
      }
    }
    // Diagonal sliders (bishop / queen)
    for (d = 0; d < BISHOP_DIRS.length; d++) {
      rr = r + BISHOP_DIRS[d][0]; cc = c + BISHOP_DIRS[d][1];
      while (onBoard(rr, cc)) {
        p = this.board[idx(rr, cc)];
        if (p) {
          if (p.color === by && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
        rr += BISHOP_DIRS[d][0]; cc += BISHOP_DIRS[d][1];
      }
    }
    // Straight sliders (rook / queen)
    for (d = 0; d < ROOK_DIRS.length; d++) {
      rr = r + ROOK_DIRS[d][0]; cc = c + ROOK_DIRS[d][1];
      while (onBoard(rr, cc)) {
        p = this.board[idx(rr, cc)];
        if (p) {
          if (p.color === by && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
        rr += ROOK_DIRS[d][0]; cc += ROOK_DIRS[d][1];
      }
    }
    return false;
  };

  P._kingAttacked = function (color) {
    var k = this._findKing(color);
    if (k < 0) return true; // no king == treated as lost
    return this.isSquareAttacked(k, other(color));
  };

  P.inCheck = function () { return this._kingAttacked(this.turn); };

  // ---- Pseudo-legal move generation ---------------------------------------

  P._push = function (list, from, to, extra) {
    var m = {
      from: from,
      to: to,
      piece: this.board[from].type,
      color: this.board[from].color,
      capture: null,
      promotion: null,
      enpassant: false,
      castle: null,
      doublePush: false
    };
    if (extra) for (var key in extra) m[key] = extra[key];
    if (m.capture === null && !m.enpassant && this.board[to]) m.capture = this.board[to].type;
    list.push(m);
  };

  P._pushPromotions = function (list, from, to, capture) {
    var promos = ['q', 'r', 'b', 'n'];
    for (var i = 0; i < promos.length; i++) {
      this._push(list, from, to, { promotion: promos[i], capture: capture });
    }
  };

  P._genPseudo = function (color) {
    var moves = [];
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (!p || p.color !== color) continue;
      var r = rankOf(i), c = fileOf(i), rr, cc, t, target, d;

      if (p.type === 'p') {
        var dir = color === 'w' ? -1 : 1;
        var startRank = color === 'w' ? 6 : 1;
        var promoRank = color === 'w' ? 0 : 7;
        // forward one
        rr = r + dir;
        if (onBoard(rr, c) && !this.board[idx(rr, c)]) {
          if (rr === promoRank) this._pushPromotions(moves, i, idx(rr, c), null);
          else this._push(moves, i, idx(rr, c), {});
          // forward two
          if (r === startRank && !this.board[idx(r + 2 * dir, c)]) {
            this._push(moves, i, idx(r + 2 * dir, c), { doublePush: true });
          }
        }
        // captures + en passant
        for (var dcp = -1; dcp <= 1; dcp += 2) {
          cc = c + dcp; rr = r + dir;
          if (!onBoard(rr, cc)) continue;
          t = idx(rr, cc);
          target = this.board[t];
          if (target && target.color !== color) {
            if (rr === promoRank) this._pushPromotions(moves, i, t, target.type);
            else this._push(moves, i, t, { capture: target.type });
          } else if (t === this.ep && this.ep >= 0) {
            this._push(moves, i, t, { enpassant: true, capture: 'p' });
          }
        }
      } else if (p.type === 'n') {
        for (d = 0; d < KNIGHT.length; d++) {
          rr = r + KNIGHT[d][0]; cc = c + KNIGHT[d][1];
          if (!onBoard(rr, cc)) continue;
          target = this.board[idx(rr, cc)];
          if (!target || target.color !== color) this._push(moves, i, idx(rr, cc), {});
        }
      } else if (p.type === 'k') {
        for (d = 0; d < KING.length; d++) {
          rr = r + KING[d][0]; cc = c + KING[d][1];
          if (!onBoard(rr, cc)) continue;
          target = this.board[idx(rr, cc)];
          if (!target || target.color !== color) this._push(moves, i, idx(rr, cc), {});
        }
        this._genCastles(moves, color, i);
      } else {
        var dirs = p.type === 'b' ? BISHOP_DIRS : p.type === 'r' ? ROOK_DIRS
          : BISHOP_DIRS.concat(ROOK_DIRS);
        for (d = 0; d < dirs.length; d++) {
          rr = r + dirs[d][0]; cc = c + dirs[d][1];
          while (onBoard(rr, cc)) {
            t = idx(rr, cc);
            target = this.board[t];
            if (!target) { this._push(moves, i, t, {}); }
            else { if (target.color !== color) this._push(moves, i, t, {}); break; }
            rr += dirs[d][0]; cc += dirs[d][1];
          }
        }
      }
    }
    return moves;
  };

  P._genCastles = function (moves, color, kingIdx) {
    var opp = other(color);
    if (color === 'w') {
      if (kingIdx !== 60) return;
      // kingside: squares f1(61) g1(62) empty; e1,f1,g1 safe; rook on h1(63)
      if (this.castling.K && !this.board[61] && !this.board[62] &&
        this.board[63] && this.board[63].type === 'r' && this.board[63].color === 'w' &&
        !this.isSquareAttacked(60, opp) && !this.isSquareAttacked(61, opp) && !this.isSquareAttacked(62, opp)) {
        this._push(moves, 60, 62, { castle: 'k' });
      }
      // queenside: d1(59) c1(58) b1(57) empty; e1,d1,c1 safe; rook a1(56)
      if (this.castling.Q && !this.board[59] && !this.board[58] && !this.board[57] &&
        this.board[56] && this.board[56].type === 'r' && this.board[56].color === 'w' &&
        !this.isSquareAttacked(60, opp) && !this.isSquareAttacked(59, opp) && !this.isSquareAttacked(58, opp)) {
        this._push(moves, 60, 58, { castle: 'q' });
      }
    } else {
      if (kingIdx !== 4) return;
      if (this.castling.k && !this.board[5] && !this.board[6] &&
        this.board[7] && this.board[7].type === 'r' && this.board[7].color === 'b' &&
        !this.isSquareAttacked(4, opp) && !this.isSquareAttacked(5, opp) && !this.isSquareAttacked(6, opp)) {
        this._push(moves, 4, 6, { castle: 'k' });
      }
      if (this.castling.q && !this.board[3] && !this.board[2] && !this.board[1] &&
        this.board[0] && this.board[0].type === 'r' && this.board[0].color === 'b' &&
        !this.isSquareAttacked(4, opp) && !this.isSquareAttacked(3, opp) && !this.isSquareAttacked(2, opp)) {
        this._push(moves, 4, 2, { castle: 'q' });
      }
    }
  };

  // ---- Make / unmake (internal) -------------------------------------------

  P._make = function (m) {
    var us = m.color;
    var undo = {
      ep: this.ep,
      castling: { K: this.castling.K, Q: this.castling.Q, k: this.castling.k, q: this.castling.q },
      halfmove: this.halfmove,
      captured: null,
      capturedIndex: -1
    };

    var piece = this.board[m.from];
    this.board[m.from] = null;

    if (m.enpassant) {
      var capIdx = idx(rankOf(m.from), fileOf(m.to));
      undo.captured = this.board[capIdx];
      undo.capturedIndex = capIdx;
      this.board[capIdx] = null;
    } else if (this.board[m.to]) {
      undo.captured = this.board[m.to];
      undo.capturedIndex = m.to;
    }

    this.board[m.to] = m.promotion ? { type: m.promotion, color: us } : piece;

    if (m.castle === 'k') {
      if (us === 'w') { this.board[61] = this.board[63]; this.board[63] = null; }
      else { this.board[5] = this.board[7]; this.board[7] = null; }
    } else if (m.castle === 'q') {
      if (us === 'w') { this.board[59] = this.board[56]; this.board[56] = null; }
      else { this.board[3] = this.board[0]; this.board[0] = null; }
    }

    // Castling rights
    if (piece.type === 'k') {
      if (us === 'w') { this.castling.K = this.castling.Q = false; }
      else { this.castling.k = this.castling.q = false; }
    }
    if (m.from === 56 || m.to === 56) this.castling.Q = false;
    if (m.from === 63 || m.to === 63) this.castling.K = false;
    if (m.from === 0 || m.to === 0) this.castling.q = false;
    if (m.from === 7 || m.to === 7) this.castling.k = false;

    this.ep = m.doublePush ? idx((rankOf(m.from) + rankOf(m.to)) / 2, fileOf(m.from)) : -1;
    this.halfmove = (piece.type === 'p' || undo.captured) ? 0 : this.halfmove + 1;
    if (us === 'b') this.fullmove++;
    this.turn = other(us);

    this._undoStack.push(undo);
    this._movesStack.push(m);
  };

  P._undo = function () {
    var m = this._movesStack.pop();
    var undo = this._undoStack.pop();
    if (!m) return null;

    var us = m.color;
    this.turn = us;
    this.castling = undo.castling;
    this.ep = undo.ep;
    this.halfmove = undo.halfmove;
    if (us === 'b') this.fullmove--;

    var moved = m.promotion ? { type: 'p', color: us } : this.board[m.to];
    this.board[m.from] = moved;
    this.board[m.to] = null;
    if (undo.capturedIndex >= 0 && undo.captured) this.board[undo.capturedIndex] = undo.captured;

    if (m.castle === 'k') {
      if (us === 'w') { this.board[63] = this.board[61]; this.board[61] = null; }
      else { this.board[7] = this.board[5]; this.board[5] = null; }
    } else if (m.castle === 'q') {
      if (us === 'w') { this.board[56] = this.board[59]; this.board[59] = null; }
      else { this.board[0] = this.board[3]; this.board[3] = null; }
    }
    return m;
  };

  // ---- Legal moves ---------------------------------------------------------

  P._legal = function (color) {
    color = color || this.turn;
    var pseudo = this._genPseudo(color);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      this._make(pseudo[i]);
      if (!this._kingAttacked(color)) out.push(pseudo[i]);
      this._undo();
    }
    return out;
  };

  /** Public: verbose legal moves, optionally restricted to a from-square. */
  P.moves = function (opts) {
    opts = opts || {};
    var legal = this._legal(this.turn);
    if (opts.square != null) {
      var sq = typeof opts.square === 'number' ? opts.square : fromAlgebraic(opts.square);
      legal = legal.filter(function (m) { return m.from === sq; });
    }
    if (opts.verbose) {
      var self = this;
      return legal.map(function (m) {
        return {
          from: toAlgebraic(m.from), to: toAlgebraic(m.to),
          fromIdx: m.from, toIdx: m.to,
          piece: m.piece, color: m.color, capture: m.capture,
          promotion: m.promotion, enpassant: m.enpassant,
          castle: m.castle, san: self._san(m, legal)
        };
      });
    }
    var self2 = this;
    return legal.map(function (m) { return self2._san(m, legal); });
  };

  P.legalTargets = function (square) {
    return this.moves({ square: square, verbose: true });
  };

  // ---- SAN -----------------------------------------------------------------

  P._san = function (m, legalList) {
    var san;
    if (m.castle === 'k') san = 'O-O';
    else if (m.castle === 'q') san = 'O-O-O';
    else {
      if (m.piece === 'p') {
        if (m.capture || m.enpassant) san = 'abcdefgh'.charAt(fileOf(m.from)) + 'x' + toAlgebraic(m.to);
        else san = toAlgebraic(m.to);
        if (m.promotion) san += '=' + m.promotion.toUpperCase();
      } else {
        san = m.piece.toUpperCase();
        var legal = legalList || this._legal(m.color);
        var amb = [];
        for (var i = 0; i < legal.length; i++) {
          var o = legal[i];
          if (o.piece === m.piece && o.to === m.to && o.from !== m.from) amb.push(o);
        }
        if (amb.length) {
          var sameFile = amb.some(function (o) { return fileOf(o.from) === fileOf(m.from); });
          var sameRank = amb.some(function (o) { return rankOf(o.from) === rankOf(m.from); });
          if (!sameFile) san += 'abcdefgh'.charAt(fileOf(m.from));
          else if (!sameRank) san += (8 - rankOf(m.from));
          else san += toAlgebraic(m.from);
        }
        if (m.capture) san += 'x';
        san += toAlgebraic(m.to);
      }
    }
    // Check / checkmate suffix
    this._make(m);
    if (this._kingAttacked(this.turn)) {
      san += this._legal(this.turn).length ? '+' : '#';
    }
    this._undo();
    return san;
  };

  // ---- Repetition bookkeeping ---------------------------------------------

  P._pushRepetition = function () {
    var key = this._positionKey();
    this._posCounts[key] = (this._posCounts[key] || 0) + 1;
    this._keyStack.push(key);
  };
  P._popRepetition = function () {
    var key = this._keyStack.pop();
    if (key && this._posCounts[key]) this._posCounts[key]--;
  };

  // ---- Public move / undo --------------------------------------------------

  /**
   * Play a move. `input` may be a SAN string, or an object
   * { from:'e2', to:'e4', promotion:'q' }. Returns the move record or null.
   */
  P.move = function (input) {
    var legal = this._legal(this.turn);
    var chosen = null, i;

    if (typeof input === 'string') {
      var want = input.replace(/[+#]/g, '').replace(/[!?]+$/, '');
      for (i = 0; i < legal.length; i++) {
        if (this._san(legal[i], legal).replace(/[+#]/g, '') === want) { chosen = legal[i]; break; }
      }
    } else if (input && input.from != null) {
      var from = typeof input.from === 'number' ? input.from : fromAlgebraic(input.from);
      var to = typeof input.to === 'number' ? input.to : fromAlgebraic(input.to);
      var promo = input.promotion || null;
      for (i = 0; i < legal.length; i++) {
        var m = legal[i];
        if (m.from !== from || m.to !== to) continue;
        if (m.promotion) { if (m.promotion === (promo || 'q')) { chosen = m; break; } }
        else { chosen = m; break; }
      }
    }

    if (!chosen) return null;
    chosen.san = this._san(chosen, legal);
    chosen.fenBefore = this.fen();
    chosen.fromAlg = toAlgebraic(chosen.from);
    chosen.toAlg = toAlgebraic(chosen.to);
    this._make(chosen);
    chosen.fenAfter = this.fen();
    this.gameMoves.push(chosen);
    this._pushRepetition();
    return chosen;
  };

  /** Take back the last played move. */
  P.undo = function () {
    if (!this.gameMoves.length) return null;
    var m = this.gameMoves.pop();
    this._popRepetition();
    this._undo();
    return m;
  };

  P.history = function (opts) {
    opts = opts || {};
    if (opts.verbose) return this.gameMoves.slice();
    return this.gameMoves.map(function (m) { return m.san; });
  };

  P.moveCount = function () { return this.gameMoves.length; };

  // ---- Game status ---------------------------------------------------------

  P.isCheckmate = function () { return this._kingAttacked(this.turn) && this._legal(this.turn).length === 0; };
  P.isStalemate = function () { return !this._kingAttacked(this.turn) && this._legal(this.turn).length === 0; };
  P.isFiftyMove = function () { return this.halfmove >= 100; };
  P.isThreefold = function () { return (this._posCounts[this._positionKey()] || 0) >= 3; };

  P.insufficientMaterial = function () {
    var minors = [];
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (!p || p.type === 'k') continue;
      if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
      minors.push({ type: p.type, sq: i });
    }
    if (minors.length <= 1) return true;            // KvK, K+minor vs K
    for (var j = 0; j < minors.length; j++) {
      if (minors[j].type === 'n') return false;     // any knight with extra material -> not auto draw
    }
    // all bishops: draw only if every bishop is on the same square colour
    var colors = {};
    for (var b = 0; b < minors.length; b++) colors[squareColor(minors[b].sq)] = true;
    return Object.keys(colors).length === 1;
  };

  P.isDraw = function () {
    return this.isStalemate() || this.isFiftyMove() || this.isThreefold() || this.insufficientMaterial();
  };
  P.isGameOver = function () { return this.isCheckmate() || this.isDraw(); };

  /** Rich status object for the UI. */
  P.status = function () {
    if (this.isCheckmate()) {
      return { over: true, reason: 'checkmate', winner: other(this.turn) };
    }
    if (this.isStalemate()) return { over: true, reason: 'stalemate', winner: null };
    if (this.isFiftyMove()) return { over: true, reason: 'fifty-move', winner: null };
    if (this.isThreefold()) return { over: true, reason: 'threefold', winner: null };
    if (this.insufficientMaterial()) return { over: true, reason: 'insufficient', winner: null };
    return { over: false, reason: this._kingAttacked(this.turn) ? 'check' : null, winner: null };
  };

  // ---- PGN -----------------------------------------------------------------

  P.pgn = function (headers) {
    var out = '';
    headers = headers || {};
    for (var h in headers) out += '[' + h + ' "' + headers[h] + '"]\n';
    if (out) out += '\n';
    var line = '';
    for (var i = 0; i < this.gameMoves.length; i++) {
      if (i % 2 === 0) line += (i / 2 + 1) + '. ';
      line += this.gameMoves[i].san + ' ';
    }
    return out + line.trim();
  };

  /** Load a game from PGN movetext (headers are ignored). */
  P.loadPgn = function (pgn) {
    this.reset();
    var text = pgn.replace(/\[[^\]]*\]/g, ' ')        // strip headers
      .replace(/\{[^}]*\}/g, ' ')                     // strip comments
      .replace(/\([^)]*\)/g, ' ')                     // strip variations (shallow)
      .replace(/\d+\.(\.\.)?/g, ' ')                  // strip move numbers
      .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');   // strip results
    var tokens = text.split(/\s+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var res = this.move(tokens[i]);
      if (!res) throw new Error('Illegal or unparsable move in PGN: ' + tokens[i]);
    }
    return true;
  };

  // ---- Perft (for testing) -------------------------------------------------

  P.perft = function (depth) {
    if (depth === 0) return 1;
    var nodes = 0;
    var legal = this._legal(this.turn);
    if (depth === 1) return legal.length;
    for (var i = 0; i < legal.length; i++) {
      this._make(legal[i]);
      nodes += this.perft(depth - 1);
      this._undo();
    }
    return nodes;
  };

  P.ascii = function () {
    var s = '';
    for (var r = 0; r < 8; r++) {
      s += (8 - r) + ' ';
      for (var c = 0; c < 8; c++) {
        var p = this.board[idx(r, c)];
        s += (p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.') + ' ';
      }
      s += '\n';
    }
    s += '  a b c d e f g h';
    return s;
  };

  global.Chess = Chess;
// globalThis works in the page, inside a Web Worker, and in Node. A bare
// `global` identifier would throw when this file is loaded by a worker.
})(globalThis);
