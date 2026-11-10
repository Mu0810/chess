/*
 * ui.js  -  BoardUI: rendering and input for the chessboard.
 *
 * Layout: the board element contains two layers -
 *   - a "squares" grid (colours, coordinates, highlight classes)
 *   - a "pieces" layer of absolutely-positioned piece elements
 * Pieces have pointer-events:none, so all input is handled at the board
 * level using geometry (elementFromPoint). Supports both drag-and-drop and
 * click / tap to move, plus a promotion picker.
 *
 * The controller supplies hooks:
 *   legalMoves(fromIdx) -> [{ toIdx, promotion|null }]
 *   canSelect(idx)      -> boolean (is this piece movable right now)
 *   onMove(fromIdx, toIdx, promotion|null)
 */
(function (global) {
  'use strict';

  var fileOf = Chess.fileOf, rankOf = Chess.rankOf, squareColor = Chess.squareColor;

  function BoardUI(boardEl, hooks) {
    this.boardEl = boardEl;
    this.hooks = hooks || {};
    this.orientation = 'w';
    this.board = new Array(64).fill(null);
    this.lastMove = null;   // {from, to}
    this.checkIdx = null;
    this.enabled = true;

    this.cells = new Array(64);      // boardIdx -> cell element
    this.pieceEls = new Array(64);   // boardIdx -> piece element
    this.selected = null;
    this.legal = [];
    this.drag = null;

    this._buildLayers();
    this._bindEvents();
    this._buildSquares();
  }

  var B = BoardUI.prototype;

  B._buildLayers = function () {
    this.boardEl.innerHTML = '';
    this.boardEl.classList.add('board-root');

    // The squares layer is the accessible grid and the keyboard focus target.
    // Pieces are drawn in a separate layer that screen readers ignore, because
    // each square already announces the piece standing on it.
    this.squaresEl = document.createElement('div');
    this.squaresEl.className = 'squares-layer';
    this.squaresEl.id = 'board-grid';
    this.squaresEl.setAttribute('role', 'grid');
    this.squaresEl.setAttribute('tabindex', '0');
    this.squaresEl.setAttribute('aria-label',
      'Chess board. Use the arrow keys to move around, Enter to pick up and place a piece, and Escape to cancel.');
    this.squaresEl.setAttribute('aria-rowcount', '8');
    this.squaresEl.setAttribute('aria-colcount', '8');

    this.piecesEl = document.createElement('div');
    this.piecesEl.className = 'pieces-layer';
    this.piecesEl.setAttribute('aria-hidden', 'true');

    this.boardEl.appendChild(this.squaresEl);
    this.boardEl.appendChild(this.piecesEl);
  };

  B._screenToBoard = function (p) {
    return this.orientation === 'w' ? p : 63 - p;
  };

  B._buildSquares = function () {
    this.squaresEl.innerHTML = '';
    this.cells = new Array(64);

    // Rows exist so the grid semantics are valid. They use display:contents so
    // the squares remain direct items of the CSS grid.
    for (var r = 0; r < 8; r++) {
      var row = document.createElement('div');
      row.className = 'sq-row';
      row.setAttribute('role', 'row');
      row.setAttribute('aria-rowindex', String(r + 1));

      for (var c = 0; c < 8; c++) {
        var p = r * 8 + c;
        var boardIdx = this._screenToBoard(p);
        var cell = document.createElement('div');
        cell.className = 'sq ' + squareColor(boardIdx);
        cell.dataset.idx = boardIdx;
        cell.id = 'sq-' + Chess.toAlgebraic(boardIdx);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-colindex', String(c + 1));

        if (c === 0) {
          var rl = document.createElement('span');
          rl.className = 'coord rank';
          rl.setAttribute('aria-hidden', 'true');
          rl.textContent = (8 - rankOf(boardIdx));
          cell.appendChild(rl);
        }
        if (r === 7) {
          var fl = document.createElement('span');
          fl.className = 'coord file';
          fl.setAttribute('aria-hidden', 'true');
          fl.textContent = 'abcdefgh'.charAt(fileOf(boardIdx));
          cell.appendChild(fl);
        }
        row.appendChild(cell);
        this.cells[boardIdx] = cell;
      }
      this.squaresEl.appendChild(row);
    }

    if (this.cursor != null) this._setCursor(this.cursor, { silent: true });
    this._updateSquareLabels();
    this._renderHighlights();
  };

  /** Describe each square so a screen reader can read the position. */
  B._updateSquareLabels = function () {
    for (var i = 0; i < 64; i++) {
      var cell = this.cells[i];
      if (!cell) continue;
      var piece = this.board[i];
      var name = Chess.toAlgebraic(i);
      var label = piece
        ? name + ', ' + (piece.color === 'w' ? 'white ' : 'black ') + Pieces.NAME[piece.type]
        : name + ', empty';
      cell.setAttribute('aria-label', label);
    }
  };

  /**
   * Position a piece on its square using the `translate` property.
   * A piece is 12.5% of the board, so 100% of its own width is exactly one
   * square: column 3 -> translate: 300% <row>00%. Keeping this on the
   * compositor (instead of animating left/top) makes moves smooth.
   */
  B._placePiece = function (el, idx) {
    var sr, sc;
    if (this.orientation === 'w') { sr = rankOf(idx); sc = fileOf(idx); }
    else { sr = 7 - rankOf(idx); sc = 7 - fileOf(idx); }
    el.style.translate = (sc * 100) + '% ' + (sr * 100) + '%';
  };

  B._renderPieces = function (options) {
    options = options || {};
    this.piecesEl.innerHTML = '';
    this.pieceEls = new Array(64);
    var shown = 0;
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (!p) continue;
      var el = Pieces.createPieceEl(p.type, p.color);
      el.dataset.idx = i;
      this._placePiece(el, i);
      if (options.stagger) {
        var delay = shown * 12;
        el.classList.add('enter');
        el.style.animationDelay = delay + 'ms';
        // Drop the class once it has played so no filled animation lingers.
        this._transient(el, 'enter', delay + 480);
      }
      this.piecesEl.appendChild(el);
      this.pieceEls[i] = el;
      shown++;
    }
  };

  /**
   * Reconcile the DOM with `this.board`. Animated updates track pieces
   * individually, so this runs afterwards as a safety net: any square whose
   * element is missing, stale, or duplicated is corrected silently.
   */
  B._syncPieces = function () {
    var seen = new Array(64);
    var stray = [];
    var nodes = this.piecesEl.children;
    var i, el, idx;

    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      // Pieces mid-capture are already detached from the board state and are
      // removed when their exit animation ends.
      if (el.classList.contains('captured-out')) continue;
      idx = +el.dataset.idx;
      var wanted = (idx >= 0 && idx < 64) ? this.board[idx] : null;
      var matches = wanted && el.dataset.type === wanted.type && el.dataset.color === wanted.color;
      if (!matches || seen[idx]) stray.push(el);
      else seen[idx] = el;
    }

    for (i = 0; i < stray.length; i++) {
      if (stray[i].parentNode) stray[i].parentNode.removeChild(stray[i]);
    }

    this.pieceEls = new Array(64);
    for (idx = 0; idx < 64; idx++) {
      var piece = this.board[idx];
      if (!piece) continue;
      if (seen[idx]) {
        this.pieceEls[idx] = seen[idx];
        continue;
      }
      el = Pieces.createPieceEl(piece.type, piece.color);
      el.dataset.idx = idx;
      this._placePiece(el, idx);
      this.piecesEl.appendChild(el);
      this.pieceEls[idx] = el;
    }
  };

  B._transient = function (el, className, duration) {
    if (!el) return;
    el.classList.add(className);
    global.setTimeout(function () { el.classList.remove(className); }, duration);
  };

  /** Short-lived decorative element layered over a square. */
  B._spawnEffect = function (idx, className, duration) {
    var cell = this.cells[idx];
    if (!cell) return;
    var fx = document.createElement('span');
    fx.className = className;
    cell.appendChild(fx);
    global.setTimeout(function () {
      if (fx.parentNode) fx.parentNode.removeChild(fx);
    }, duration);
  };

  /** Fade a captured piece out in place instead of removing it instantly. */
  B._dissolve = function (el) {
    if (!el) return;
    el.classList.add('captured-out');
    el.dataset.idx = '-1';
    global.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 320);
  };

  /**
   * Animate a single played move, then reconcile.
   * `move` is an engine move record (from/to indices, capture, castle,
   * enpassant, promotion). Returns false when the move cannot be animated
   * from the currently rendered position.
   */
  B._animateMove = function (move) {
    var mover = this.pieceEls[move.from];
    if (!mover) return false;

    var self = this;
    var captureIdx = -1;
    if (move.enpassant) captureIdx = rankOf(move.from) * 8 + fileOf(move.to);
    else if (this.pieceEls[move.to]) captureIdx = move.to;

    if (captureIdx >= 0) {
      this._dissolve(this.pieceEls[captureIdx]);
      this.pieceEls[captureIdx] = null;
      this._spawnEffect(captureIdx, 'fx-burst', 620);
    }

    this.pieceEls[move.from] = null;
    this.pieceEls[move.to] = mover;
    mover.dataset.idx = move.to;
    this._transient(mover, 'gliding', 260);
    this._placePiece(mover, move.to);

    if (move.castle) {
      var rookFrom = move.castle === 'k' ? (move.color === 'w' ? 63 : 7) : (move.color === 'w' ? 56 : 0);
      var rookTo = move.castle === 'k' ? (move.color === 'w' ? 61 : 5) : (move.color === 'w' ? 59 : 3);
      var rook = this.pieceEls[rookFrom];
      if (rook) {
        this.pieceEls[rookFrom] = null;
        this.pieceEls[rookTo] = rook;
        rook.dataset.idx = rookTo;
        this._transient(rook, 'gliding', 260);
        this._placePiece(rook, rookTo);
      }
    }

    if (move.promotion) {
      global.setTimeout(function () {
        var current = self.pieceEls[move.to];
        if (current && current.dataset.color === move.color) {
          current.textContent = Pieces.GLYPH[move.promotion];
          current.dataset.type = move.promotion;
          self._transient(current, 'promoted', 640);
        }
        self._spawnEffect(move.to, 'fx-promote', 720);
      }, 180);
    }

    this._spawnEffect(move.to, 'fx-land', 520);
    return true;
  };

  B._renderHighlights = function () {
    for (var i = 0; i < 64; i++) {
      var c = this.cells[i];
      if (!c) continue;
      c.classList.remove('sel', 'last', 'check', 'legal', 'legal-cap');
    }
    if (this.lastMove) {
      if (this.cells[this.lastMove.from]) this.cells[this.lastMove.from].classList.add('last');
      if (this.cells[this.lastMove.to]) this.cells[this.lastMove.to].classList.add('last');
    }
    if (this.checkIdx != null && this.cells[this.checkIdx]) {
      this.cells[this.checkIdx].classList.add('check');
    }
    if (this.selected != null && this.cells[this.selected]) {
      this.cells[this.selected].classList.add('sel');
      for (var k = 0; k < this.legal.length; k++) {
        var t = this.legal[k].toIdx;
        var cell = this.cells[t];
        if (!cell) continue;
        cell.style.setProperty('--marker-delay', (k * 22) + 'ms');
        cell.classList.add(this.board[t] ? 'legal-cap' : 'legal');
      }
    }
  };

  // ---- Public API ----------------------------------------------------------

  B.setPosition = function (state) {
    // A pending choice belongs to the position that opened it. Navigation,
    // imports, and a new game must not leave an old move waiting to fire.
    if (this._promotionCancel) this._promotionCancel();
    var previous = this.board;
    this.board = state.board.slice();
    if (state.lastMove !== undefined) this.lastMove = state.lastMove;
    if (state.check !== undefined) this.checkIdx = state.check;
    this._clearSelectionState();

    var animated = false;
    if (state.move && previous && previous[state.move.from]) {
      animated = this._animateMove(state.move);
    }
    if (animated) this._syncPieces();
    else this._renderPieces({ stagger: !!state.stagger });

    this._updateSquareLabels();
    this._renderHighlights();
  };

  B.setEnabled = function (v) { this.enabled = v; if (!v) this._clearSelection(); };

  B.setOrientation = function (color) {
    this.orientation = color === 'b' ? 'b' : 'w';
    this._buildSquares();
    this._renderPieces();
  };

  B.flip = function () {
    var self = this;
    var stage = this.boardEl.parentNode;
    if (stage && stage.classList) this._transient(stage, 'flipping', 460);
    global.setTimeout(function () {
      self.setOrientation(self.orientation === 'w' ? 'b' : 'w');
    }, 170);
  };

  // ---- Selection -----------------------------------------------------------

  B._clearSelectionState = function () { this.selected = null; this.legal = []; };

  B._clearSelection = function () {
    this._clearSelectionState();
    this._renderHighlights();
  };

  B._select = function (idx) {
    this.selected = idx;
    this.legal = (this.hooks.legalMoves ? this.hooks.legalMoves(idx) : []) || [];
    this._renderHighlights();
  };

  B._isLegalTarget = function (idx) {
    for (var i = 0; i < this.legal.length; i++) if (this.legal[i].toIdx === idx) return true;
    return false;
  };

  B._idxFromPoint = function (x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var sq = el.closest ? el.closest('.sq') : null;
    return sq ? +sq.dataset.idx : null;
  };

  // ---- Move attempt (handles promotion) ------------------------------------

  B._attempt = function (from, to) {
    var needsPromo = false;
    for (var i = 0; i < this.legal.length; i++) {
      if (this.legal[i].toIdx === to && this.legal[i].promotion) { needsPromo = true; break; }
    }
    var self = this;
    var color = this.board[from] ? this.board[from].color : 'w';
    this._clearSelection();
    if (needsPromo) {
      this.showPromotion(color, function (type) {
        if (type && self.hooks.onMove) self.hooks.onMove(from, to, type);
        else self._renderPieces();
      });
    } else {
      if (this.hooks.onMove) this.hooks.onMove(from, to, null);
    }
  };

  // ---- Keyboard ------------------------------------------------------------

  /** Screen position of a board square, honouring the current orientation. */
  B._screenOf = function (idx) {
    return this.orientation === 'w'
      ? { row: rankOf(idx), col: fileOf(idx) }
      : { row: 7 - rankOf(idx), col: 7 - fileOf(idx) };
  };

  B._idxAtScreen = function (row, col) {
    var p = row * 8 + col;
    return this._screenToBoard(p);
  };

  B._setCursor = function (idx, opts) {
    opts = opts || {};
    var previous = this.cursor;
    this.cursor = idx;
    if (previous != null && this.cells[previous]) this.cells[previous].classList.remove('cursor');
    var cell = this.cells[idx];
    if (!cell) return;
    cell.classList.add('cursor');
    this.squaresEl.setAttribute('aria-activedescendant', cell.id);
    if (!opts.silent && this.hooks.announce) {
      this.hooks.announce(cell.getAttribute('aria-label'));
    }
  };

  /** Where the cursor starts when the board first receives focus. */
  B._defaultCursor = function () {
    for (var i = 0; i < 64; i++) {
      var piece = this.board[i];
      if (piece && piece.color === this.orientation && piece.type === 'k') return i;
    }
    return this.orientation === 'w' ? Chess.fromAlgebraic('e2') : Chess.fromAlgebraic('e7');
  };

  B._onKeyDown = function (e) {
    if (this._promotionCancel) return;
    var steps = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
    };

    if (this.cursor == null) this._setCursor(this._defaultCursor(), { silent: true });

    if (steps[e.key]) {
      e.preventDefault();
      var at = this._screenOf(this.cursor);
      var row = Math.min(7, Math.max(0, at.row + steps[e.key][0]));
      var col = Math.min(7, Math.max(0, at.col + steps[e.key][1]));
      this._setCursor(this._idxAtScreen(row, col));
      return;
    }

    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this._activateCursor();
      return;
    }

    if (e.key === 'Escape') {
      if (this.selected != null) {
        e.preventDefault();
        this._clearSelection();
        if (this.hooks.announce) this.hooks.announce('Selection cleared.');
      }
      return;
    }

    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      var pos = this._screenOf(this.cursor);
      this._setCursor(this._idxAtScreen(pos.row, e.key === 'Home' ? 0 : 7));
    }
  };

  /** Enter / Space: pick up a piece, or place the one already picked up. */
  B._activateCursor = function () {
    if (!this.enabled) {
      if (this.hooks.announce) this.hooks.announce('The board is not accepting moves right now.');
      return;
    }
    var idx = this.cursor;
    if (idx == null) return;

    if (this.selected != null && this._isLegalTarget(idx)) {
      this._attempt(this.selected, idx);
      return;
    }
    if (this.selected === idx) {
      this._clearSelection();
      if (this.hooks.announce) this.hooks.announce('Selection cleared.');
      return;
    }

    var canSelect = this.hooks.canSelect ? this.hooks.canSelect(idx) : !!this.board[idx];
    if (canSelect && this.board[idx]) {
      this._select(idx);
      if (this.hooks.announce) {
        var moves = this.legal.length;
        this.hooks.announce(this.cells[idx].getAttribute('aria-label') + ' selected, ' +
          moves + (moves === 1 ? ' move' : ' moves') + ' available.');
      }
    } else if (this.hooks.announce) {
      this.hooks.announce(this.board[idx] ? 'That piece cannot move now.' : 'That square is empty.');
    }
  };

  // ---- Input ---------------------------------------------------------------

  B._bindEvents = function () {
    var self = this;
    this.squaresEl.addEventListener('keydown', function (e) { self._onKeyDown(e); });
    this.squaresEl.addEventListener('focus', function () {
      if (self.cursor == null) self._setCursor(self._defaultCursor(), { silent: true });
    });
    this.boardEl.addEventListener('pointerdown', function (e) { self._onDown(e); });
    this.boardEl.addEventListener('pointermove', function (e) { self._onMove(e); });
    this.boardEl.addEventListener('pointerup', function (e) { self._onUp(e); });
    this.boardEl.addEventListener('pointercancel', function () { self._cancelDrag(); });
    this.boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  B._onDown = function (e) {
    if (!this.enabled || this._promotionCancel) return;
    var idx = this._idxFromPoint(e.clientX, e.clientY);
    if (idx == null) return;
    e.preventDefault();

    // If something is selected and this is a legal destination -> move.
    if (this.selected != null && this._isLegalTarget(idx)) {
      this._attempt(this.selected, idx);
      return;
    }

    var canSel = this.hooks.canSelect ? this.hooks.canSelect(idx) : !!this.board[idx];
    if (canSel && this.board[idx]) {
      if (this.selected === idx) { this._clearSelection(); return; }
      this._select(idx);
      this._setCursor(idx, { silent: true });   // keep the keyboard cursor in step
      this.drag = { fromIdx: idx, startX: e.clientX, startY: e.clientY, active: false, el: this.pieceEls[idx] };
      try { this.boardEl.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    } else {
      this._clearSelection();
    }
  };

  B._onMove = function (e) {
    if (!this.drag) return;
    var dx = e.clientX - this.drag.startX;
    var dy = e.clientY - this.drag.startY;
    if (!this.drag.active) {
      if (dx * dx + dy * dy < 25) return; // movement threshold
      this.drag.active = true;
      if (this.drag.el) this.drag.el.classList.add('dragging');
    }
    if (!this.drag.el) return;
    var rect = this.boardEl.getBoundingClientRect();
    var half = rect.width / 16;
    var x = e.clientX - rect.left - half;
    var y = e.clientY - rect.top - half;
    this.drag.el.style.translate = x + 'px ' + y + 'px';
  };

  B._onUp = function (e) {
    if (!this.drag) return;
    var d = this.drag;
    try { this.boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (d.active) {
      if (d.el) d.el.classList.remove('dragging');
      var idx = this._idxFromPoint(e.clientX, e.clientY);
      this.drag = null;
      if (idx != null && idx !== d.fromIdx && this._isLegalTarget(idx)) {
        this._attempt(d.fromIdx, idx);
      } else {
        if (d.el) this._placePiece(d.el, d.fromIdx); // snap back
        // keep selection so a subsequent click can still move
      }
    } else {
      // a plain click/tap: selection already applied, wait for target click
      this.drag = null;
    }
  };

  B._cancelDrag = function () {
    if (this.drag && this.drag.el) {
      this.drag.el.classList.remove('dragging');
      this._placePiece(this.drag.el, this.drag.fromIdx);
    }
    this.drag = null;
  };

  // ---- Promotion picker ----------------------------------------------------

  B.showPromotion = function (color, cb) {
    if (this._promotionCancel) this._promotionCancel();
    var self = this;
    var modal = document.getElementById('promo-modal');
    var box = document.getElementById('promo-box');
    box.innerHTML = '';
    var types = ['q', 'r', 'b', 'n'];
    var options = [];
    var settled = false;
    function finish(type) {
      if (settled) return;
      settled = true;
      self._promotionCancel = null;
      modal.classList.add('hidden');
      modal.removeEventListener('pointerdown', onBackdrop);
      modal.removeEventListener('keydown', onKey);
      cb(type);
      self.squaresEl.focus();
    }
    function onBackdrop(ev) {
      if (ev.target === modal) finish(null);
    }
    function onKey(ev) {
      // Global shortcuts (notably N for a new game) must not run behind the
      // picker. Modified keys retain their normal browser behaviour.
      ev.stopPropagation();
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

      var idx = options.indexOf(document.activeElement);
      if (idx < 0) idx = 0;
      var step = 0;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(null);
      } else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        finish(types[idx]);
      } else if (ev.key === 'Tab' || ev.key.indexOf('Arrow') === 0) {
        ev.preventDefault();
        step = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || (ev.key === 'Tab' && ev.shiftKey) ? -1 : 1;
        options[(idx + step + options.length) % options.length].focus();
      } else if (ev.key === 'Home' || ev.key === 'End') {
        ev.preventDefault();
        options[ev.key === 'Home' ? 0 : options.length - 1].focus();
      } else {
        var type = ev.key.toLowerCase();
        if (types.indexOf(type) >= 0) {
          ev.preventDefault();
          finish(type);
        }
      }
    }
    for (var i = 0; i < types.length; i++) {
      (function (t, index) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'promo-opt ' + (color === 'w' ? 'white' : 'black');
        opt.style.animationDelay = (index * 55) + 'ms';
        opt.setAttribute('aria-label', 'Promote to ' + Pieces.NAME[t]);
        opt.title = 'Promote to ' + Pieces.NAME[t] + ' (' + t.toUpperCase() + ')';
        var glyph = Pieces.glyphSpan(t, color);
        glyph.setAttribute('aria-hidden', 'true');
        opt.appendChild(glyph);
        opt.addEventListener('click', function () { finish(t); });
        options.push(opt);
        box.appendChild(opt);
      })(types[i], i);
    }
    this._promotionCancel = function () { finish(null); };
    modal.addEventListener('pointerdown', onBackdrop);
    modal.addEventListener('keydown', onKey);
    modal.classList.remove('hidden');
    options[0].focus();
  };

  global.BoardUI = BoardUI;
})(window);
