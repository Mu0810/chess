/*
 * game.js - Application controller.
 *
 * Connects the rules engine, board UI, computer opponent, clocks, move list,
 * navigation, captured-piece trays, game actions, and FEN/PGN tools.
 */
(function (global) {
  'use strict';

  var MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  function Game() {
    var self = this;

    this.engine = new Chess();
    this.ai = new ChessAI();
    this.sounds = new Sounds();
    this.config = {
      mode: 'human',
      aiLevel: 2,
      humanColor: 'w',
      baseSeconds: 600,
      increment: 0
    };

    this.active = true;
    this.result = null;
    this.aiThinking = false;
    this.aiTimer = null;
    this.viewIndex = 0;
    this.startFen = Chess.START_FEN;
    this.snapshots = [this.engine.fen()];

    this.clocks = { w: 600000, b: 600000 };
    this.clockHistory = [{ w: 600000, b: 600000 }];
    this.clockRunning = false;
    this.lastTick = performance.now();

    this.boardUI = new BoardUI(document.getElementById('board'), {
      legalMoves: function (idx) { return self._legalMoves(idx); },
      canSelect: function (idx) { return self._canSelect(idx); },
      onMove: function (from, to, promotion) { self._humanMove(from, to, promotion); }
    });

    this._cacheDom();
    this._bindActions();
    this._clockInterval = global.setInterval(function () { self._tick(); }, 100);
    this._renderAll();
  }

  var G = Game.prototype;

  G._cacheDom = function () {
    this.el = {
      status: document.getElementById('status-line'),
      evaluation: document.getElementById('eval-line'),
      moves: document.getElementById('moves-body'),
      clockTop: document.getElementById('clock-top'),
      clockBottom: document.getElementById('clock-bottom'),
      playerTop: document.getElementById('player-top'),
      playerBottom: document.getElementById('player-bottom'),
      nameTop: document.getElementById('name-top'),
      nameBottom: document.getElementById('name-bottom'),
      avatarTop: document.getElementById('avatar-top'),
      avatarBottom: document.getElementById('avatar-bottom'),
      capturedTop: document.getElementById('captured-top'),
      capturedBottom: document.getElementById('captured-bottom'),
      ioText: document.getElementById('io-text'),
      gameoverModal: document.getElementById('gameover-modal'),
      gameoverResult: document.getElementById('gameover-result'),
      gameoverDetail: document.getElementById('gameover-detail'),
      gameoverBadge: document.getElementById('gameover-badge'),
      statusPanel: document.getElementById('status-panel'),
      turnDot: document.getElementById('turn-dot'),
      thinking: document.getElementById('thinking'),
      evalFill: document.getElementById('eval-fill'),
      boardWrap: document.getElementById('board-wrap'),
      celebration: document.getElementById('celebration'),
      confirmModal: document.getElementById('confirm-modal'),
      confirmTitle: document.getElementById('confirm-title'),
      confirmDetail: document.getElementById('confirm-detail'),
      confirmOk: document.getElementById('confirm-ok'),
      confirmCancel: document.getElementById('confirm-cancel')
    };
  };

  /**
   * In-app confirmation dialog. Replaces window.confirm so the interaction
   * stays inside the app's own design and can be styled and animated.
   * Calls `cb(true)` on confirm, `cb(false)` on cancel / Escape / backdrop.
   */
  G.confirm = function (opts, cb) {
    var self = this;
    var modal = this.el.confirmModal;
    if (!modal) { cb(global.confirm(opts.title)); return; }

    this.el.confirmTitle.textContent = opts.title || 'Are you sure?';
    this.el.confirmDetail.textContent = opts.detail || '';
    this.el.confirmOk.textContent = opts.confirmLabel || 'Confirm';
    this.el.confirmOk.classList.toggle('danger', !!opts.danger);

    var settled = false;
    function close(result) {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      self.el.confirmOk.removeEventListener('click', onOk);
      self.el.confirmCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('pointerdown', onBackdrop);
      document.removeEventListener('keydown', onKey);
      self.confirmOpen = false;
      cb(result);
    }
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBackdrop(ev) { if (ev.target === modal) close(false); }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
      else if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
    }

    this.el.confirmOk.addEventListener('click', onOk);
    this.el.confirmCancel.addEventListener('click', onCancel);
    modal.addEventListener('pointerdown', onBackdrop);
    document.addEventListener('keydown', onKey);

    this.confirmOpen = true;
    modal.classList.remove('hidden');
    this.el.confirmOk.focus();
  };

  G._bindActions = function () {
    var self = this;

    document.getElementById('btn-flip').addEventListener('click', function () {
      self.boardUI.flip();
      self._renderPlayerBars();
      self._renderClocks();
    });
    document.getElementById('btn-takeback').addEventListener('click', function () { self.takeback(); });
    document.getElementById('btn-draw').addEventListener('click', function () { self.offerDraw(); });
    document.getElementById('btn-resign').addEventListener('click', function () { self.resign(); });

    document.getElementById('nav-first').addEventListener('click', function () { self.navigate(0); });
    document.getElementById('nav-prev').addEventListener('click', function () { self.navigate(self.viewIndex - 1); });
    document.getElementById('nav-next').addEventListener('click', function () { self.navigate(self.viewIndex + 1); });
    document.getElementById('nav-last').addEventListener('click', function () { self.navigate(self.engine.gameMoves.length); });

    document.getElementById('btn-copy-pgn').addEventListener('click', function () { self.copyPgn(); });
    document.getElementById('btn-copy-fen').addEventListener('click', function () { self.copyFen(); });
    document.getElementById('btn-load-fen').addEventListener('click', function () { self.loadFen(self.el.ioText.value); });
    document.getElementById('btn-load-pgn').addEventListener('click', function () { self.loadPgn(self.el.ioText.value); });

    document.getElementById('gameover-review').addEventListener('click', function () {
      self.el.gameoverModal.classList.add('hidden');
      self.navigate(self.engine.gameMoves.length);
    });
    document.getElementById('gameover-newgame').addEventListener('click', function () {
      self.el.gameoverModal.classList.add('hidden');
      document.getElementById('btn-new-game').click();
    });
  };

  // ---- Starting / loading --------------------------------------------------

  G.start = function (options) {
    options = options || {};
    this._cancelAI();

    this.config.mode = options.mode === 'ai' ? 'ai' : 'human';
    this.config.aiLevel = Math.max(1, Math.min(4, +(options.aiLevel || 2)));
    this.config.humanColor = options.humanColor === 'b' ? 'b' : 'w';
    this.config.baseSeconds = Math.max(0, +(options.baseSeconds || 0));
    this.config.increment = Math.max(0, +(options.increment || 0));

    this.engine = new Chess();
    this.startFen = this.engine.fen();
    this.snapshots = [this.engine.fen()];
    this.active = true;
    this.result = null;
    this.aiThinking = false;
    this.viewIndex = 0;

    var initialMs = this.config.baseSeconds * 1000;
    this.clocks = { w: initialMs, b: initialMs };
    this.clockHistory = [{ w: initialMs, b: initialMs }];
    this.clockRunning = false;
    this.lastTick = performance.now();

    this._pendingMove = null;
    this._justMoved = false;
    this._staggerNext = true;    // pieces cascade onto a fresh board
    this.boardUI.setOrientation(this.config.mode === 'ai' ? this.config.humanColor : 'w');
    this.el.gameoverModal.classList.add('hidden');
    this._clearCelebration();
    this.sounds.play('start');
    this._renderAll();
    this._maybeAI();
  };

  G._validatePosition = function (chess) {
    var wk = 0, bk = 0;
    for (var i = 0; i < 64; i++) {
      var p = chess.board[i];
      if (p && p.type === 'k') {
        if (p.color === 'w') wk++; else bk++;
      }
    }
    if (wk !== 1 || bk !== 1) throw new Error('Position must contain exactly one king of each color.');
    if (chess._kingAttacked('w') && chess._kingAttacked('b')) {
      throw new Error('Both kings cannot be in check at the same time.');
    }
  };

  G.loadFen = function (text) {
    text = (text || '').trim();
    if (!text) { this.toast('Paste a FEN position first.'); return; }
    try {
      var c = new Chess(text);
      this._validatePosition(c);
      this._cancelAI();
      this.engine = c;
      this.startFen = c.fen();
      this.snapshots = [c.fen()];
      this.viewIndex = 0;
      this.active = !c.isGameOver();
      this.result = this.active ? null : c.status();
      this._resetLoadedClocks();
      this._renderAll();
      this.toast('FEN loaded.');
      this._maybeAI();
    } catch (err) {
      this.toast('Could not load FEN: ' + err.message, true);
    }
  };

  G.loadPgn = function (text) {
    text = (text || '').trim();
    if (!text) { this.toast('Paste PGN movetext first.'); return; }
    try {
      var c = new Chess();
      c.loadPgn(text);
      this._validatePosition(c);
      this._cancelAI();
      this.engine = c;
      this.startFen = Chess.START_FEN;
      this.snapshots = [Chess.START_FEN];
      for (var i = 0; i < c.gameMoves.length; i++) this.snapshots.push(c.gameMoves[i].fenAfter);
      this.viewIndex = c.gameMoves.length;
      this.active = !c.isGameOver();
      this.result = this.active ? null : c.status();
      this._resetLoadedClocks();
      this._renderAll();
      this.toast('PGN loaded: ' + c.gameMoves.length + ' moves.');
      this._maybeAI();
    } catch (err) {
      this.toast('Could not load PGN: ' + err.message, true);
    }
  };

  G._resetLoadedClocks = function () {
    var ms = this.config.baseSeconds * 1000;
    this.clocks = { w: ms, b: ms };
    this.clockHistory = [];
    for (var i = 0; i <= this.engine.gameMoves.length; i++) {
      this.clockHistory.push({ w: ms, b: ms });
    }
    this.clockRunning = false;
    this.lastTick = performance.now();
  };

  // ---- Input and move execution -------------------------------------------

  G._atLatest = function () { return this.viewIndex === this.engine.gameMoves.length; };

  G._isHumanTurn = function () {
    return this.config.mode === 'human' || this.engine.turn === this.config.humanColor;
  };

  G._canSelect = function (idx) {
    if (!this.active || !this._atLatest() || this.aiThinking || !this._isHumanTurn()) return false;
    var p = this.engine.get(idx);
    return !!p && p.color === this.engine.turn;
  };

  G._legalMoves = function (idx) {
    if (!this._canSelect(idx)) return [];
    return this.engine.legalTargets(idx);
  };

  G._humanMove = function (from, to, promotion) {
    if (!this._canSelect(from)) return;
    var moved = this._playMove({ from: from, to: to, promotion: promotion || undefined });
    if (!moved) {
      this.sounds.play('illegal');
      this._renderBoard();
    }
  };

  G._playMove = function (input) {
    if (!this.active) return null;
    var mover = this.engine.turn;
    if (this.clockRunning) this._syncClock();
    if (!this.active) return null;

    var move = this.engine.move(input);
    if (!move) return null;

    if (this.config.baseSeconds > 0) {
      this.clocks[mover] += this.config.increment * 1000;
      this.clockRunning = true;
      this.lastTick = performance.now();
    }

    this.snapshots.push(move.fenAfter);
    this.clockHistory.push({ w: this.clocks.w, b: this.clocks.b });
    this.viewIndex = this.engine.gameMoves.length;

    var status = this.engine.status();
    this._playMoveSound(move, status);
    this._pendingMove = move;   // lets the board animate this exact move
    this._justMoved = true;
    this._renderAll();

    if (status.reason === 'check' && this.el.boardWrap) {
      this.boardUI._transient(this.el.boardWrap, 'shock', 520);
    }

    if (status.over) this._finish(status);
    else this._maybeAI();
    return move;
  };

  G._playMoveSound = function (move, status) {
    if (status.over) this.sounds.play('end');
    else if (status.reason === 'check') this.sounds.play('check');
    else if (move.promotion) this.sounds.play('promote');
    else if (move.castle) this.sounds.play('castle');
    else if (move.capture) this.sounds.play('capture');
    else this.sounds.play('move');
  };

  // ---- AI ------------------------------------------------------------------

  G._cancelAI = function () {
    if (this.aiTimer) global.clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.aiThinking = false;
  };

  G._maybeAI = function () {
    var self = this;
    if (!this.active || this.config.mode !== 'ai' || this.engine.turn === this.config.humanColor) {
      this.aiThinking = false;
      this._renderStatus();
      this._updateBoardEnabled();
      return;
    }

    this._cancelAI();
    this.aiThinking = true;
    this._renderStatus();
    this._updateBoardEnabled();
    this.aiTimer = global.setTimeout(function () {
      self.aiTimer = null;
      if (!self.active || self.engine.turn === self.config.humanColor) return;
      var move;
      try {
        move = self.ai.chooseMove(self.engine, self.config.aiLevel);
      } catch (err) {
        self.aiThinking = false;
        self.toast('Computer error: ' + err.message, true);
        self._updateBoardEnabled();
        return;
      }
      self.aiThinking = false;
      if (move) self._playMove(move);
      else self._renderAll();
    }, 320);
  };

  // ---- Clocks --------------------------------------------------------------

  G._syncClock = function () {
    var now = performance.now();
    var elapsed = now - this.lastTick;
    this.lastTick = now;
    if (!this.clockRunning || !this.active || this.config.baseSeconds <= 0) return;

    var side = this.engine.turn;
    this.clocks[side] = Math.max(0, this.clocks[side] - elapsed);
    if (this.clocks[side] <= 0) {
      this.clocks[side] = 0;
      this._finish({ over: true, reason: 'timeout', winner: side === 'w' ? 'b' : 'w' });
    }
  };

  G._tick = function () {
    this._syncClock();
    this._renderClocks();
  };

  G._formatClock = function (ms) {
    if (this.config.baseSeconds <= 0) return '\u221e';
    ms = Math.max(0, ms);
    if (ms < 10000) {
      var totalTenths = Math.ceil(ms / 100);
      var lowMin = Math.floor(totalTenths / 600);
      var lowSec = Math.floor((totalTenths % 600) / 10);
      var tenths = totalTenths % 10;
      return lowMin + ':' + String(lowSec).padStart(2, '0') + '.' + tenths;
    }
    var total = Math.ceil(ms / 1000);
    var min = Math.floor(total / 60);
    var sec = total % 60;
    return min + ':' + String(sec).padStart(2, '0');
  };

  G._colorAtBottom = function () { return this.boardUI.orientation; };

  G._renderClocks = function () {
    var bottom = this._colorAtBottom();
    var top = bottom === 'w' ? 'b' : 'w';
    this.el.clockBottom.textContent = this._formatClock(this.clocks[bottom]);
    this.el.clockTop.textContent = this._formatClock(this.clocks[top]);

    var timed = this.config.baseSeconds > 0;
    this.el.clockBottom.classList.toggle('low', timed && this.clocks[bottom] < 20000);
    this.el.clockTop.classList.toggle('low', timed && this.clocks[top] < 20000);
    this.el.clockBottom.classList.toggle('critical', timed && this.active && this.clocks[bottom] < 10000);
    this.el.clockTop.classList.toggle('critical', timed && this.active && this.clocks[top] < 10000);

    var bottomActive = this.active && this.clockRunning && this.engine.turn === bottom;
    var topActive = this.active && this.clockRunning && this.engine.turn === top;
    this.el.playerBottom.classList.toggle('active-turn', bottomActive);
    this.el.playerTop.classList.toggle('active-turn', topActive);
    this.el.clockBottom.classList.toggle('active', bottomActive);
    this.el.clockTop.classList.toggle('active', topActive);
  };

  // ---- Navigation ----------------------------------------------------------

  G.navigate = function (index) {
    var max = this.engine.gameMoves.length;
    this.viewIndex = Math.max(0, Math.min(max, index));
    this._renderBoard();
    this._renderMoveList();
    this._renderStatus();
    this._updateBoardEnabled();
  };

  G._viewer = function () {
    if (this._atLatest()) return this.engine;
    return new Chess(this.snapshots[this.viewIndex]);
  };

  // ---- Actions -------------------------------------------------------------

  G.takeback = function () {
    if (!this.engine.gameMoves.length) { this.toast('No moves to take back.'); return; }
    this._cancelAI();
    this._syncClock();
    this.active = true;
    this.result = null;
    this.el.gameoverModal.classList.add('hidden');

    this._undoOne();
    if (this.config.mode === 'ai') {
      while (this.engine.gameMoves.length && this.engine.turn !== this.config.humanColor) this._undoOne();
    }

    this.viewIndex = this.engine.gameMoves.length;
    this.clockRunning = this.engine.gameMoves.length > 0 && this.config.baseSeconds > 0;
    this.lastTick = performance.now();
    this._renderAll();
    this.toast('Move taken back.');
    this._maybeAI();
  };

  G._undoOne = function () {
    if (!this.engine.undo()) return;
    this.snapshots.pop();
    this.clockHistory.pop();
    var prev = this.clockHistory[this.clockHistory.length - 1];
    if (prev) this.clocks = { w: prev.w, b: prev.b };
  };

  G.offerDraw = function () {
    if (!this.active) { this.toast('The game is already over.'); return; }
    if (this.config.mode === 'ai') {
      var score = this.ai.evaluate(this.engine);
      var fromHumanView = this.config.humanColor === 'w' ? score : -score;
      // Accept when the computer is not meaningfully ahead, or when the
      // 50-move counter is already close to making the position a draw.
      if (fromHumanView >= -30 || this.engine.halfmove >= 80) {
        this._finish({ over: true, reason: 'agreement', winner: null });
      } else {
        this.toast('The computer declined the draw offer.');
      }
      return;
    }
    var self = this;
    this.confirm({
      title: 'Agree to a draw?',
      detail: 'Both players need to accept. The game ends as a draw.',
      confirmLabel: 'Agree to draw'
    }, function (ok) {
      if (ok) self._finish({ over: true, reason: 'agreement', winner: null });
    });
  };

  G.resign = function () {
    if (!this.active) { this.toast('The game is already over.'); return; }
    var side = this.engine.turn;
    if (this.config.mode === 'ai') side = this.config.humanColor;
    var name = side === 'w' ? 'White' : 'Black';
    var self = this;
    this.confirm({
      title: 'Resign as ' + name + '?',
      detail: 'This ends the game and awards the win to your opponent.',
      confirmLabel: 'Resign',
      danger: true
    }, function (ok) {
      if (ok) self._finish({ over: true, reason: 'resignation', winner: side === 'w' ? 'b' : 'w' });
    });
  };

  G._finish = function (status) {
    if (!this.active && this.result) return;
    this.active = false;
    this.result = status;
    this.clockRunning = false;
    this._cancelAI();
    this._renderAll();
    this._showGameOver(status);
  };

  G._showGameOver = function (status) {
    var title = 'Game Over', detail = '';
    if (status.winner) detail = (status.winner === 'w' ? 'White' : 'Black') + ' wins';
    else detail = 'Draw';

    var reasonText = {
      checkmate: 'Checkmate', timeout: 'Time out', resignation: 'Resignation',
      stalemate: 'Stalemate', 'fifty-move': '50-move rule', threefold: 'Threefold repetition',
      insufficient: 'Insufficient material', agreement: 'Draw agreed'
    };
    title = reasonText[status.reason] || title;
    if (!status.winner && status.reason !== 'agreement') detail = 'Draw by ' + title.toLowerCase();

    this.el.gameoverResult.textContent = title;
    this.el.gameoverDetail.textContent = detail;
    if (this.el.gameoverBadge) {
      this.el.gameoverBadge.textContent = status.winner ? '\u265A' : '\u00BD';
      this.el.gameoverBadge.classList.toggle('draw', !status.winner);
    }
    this.el.gameoverModal.classList.remove('hidden');
    if (status.winner) this._celebrate();
  };

  G._clearCelebration = function () {
    if (this.el.celebration) this.el.celebration.innerHTML = '';
  };

  /** Confetti burst on a decisive result. Purely decorative. */
  G._celebrate = function () {
    var host = this.el.celebration;
    if (!host) return;
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    host.innerHTML = '';
    var colors = ['#81b64c', '#f5d76e', '#e9e9e4', '#5f9dbd', '#d1514b'];
    for (var i = 0; i < 70; i++) {
      var bit = document.createElement('span');
      bit.className = 'confetti';
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = (Math.random() * 550) + 'ms';
      bit.style.animationDuration = (1900 + Math.random() * 1500) + 'ms';
      bit.style.setProperty('--drift', (Math.random() * 160 - 80).toFixed(0) + 'px');
      bit.style.setProperty('--spin', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      host.appendChild(bit);
    }
    var self = this;
    global.clearTimeout(this._confettiTimer);
    this._confettiTimer = global.setTimeout(function () { self._clearCelebration(); }, 4200);
  };

  // ---- Export / clipboard --------------------------------------------------

  G._pgnHeaders = function () {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var h = {
      Event: 'Kiro Chess Game',
      Date: yyyy + '.' + mm + '.' + dd,
      White: this._nameForColor('w'),
      Black: this._nameForColor('b'),
      Result: this._resultToken()
    };
    if (this.startFen !== Chess.START_FEN) {
      h.SetUp = '1';
      h.FEN = this.startFen;
    }
    return h;
  };

  G._resultToken = function () {
    if (!this.result) return '*';
    if (this.result.winner === 'w') return '1-0';
    if (this.result.winner === 'b') return '0-1';
    return '1/2-1/2';
  };

  G.copyPgn = function () {
    var pgn = this.engine.pgn(this._pgnHeaders());
    if (this.result) pgn += (pgn ? ' ' : '') + this._resultToken();
    this.el.ioText.value = pgn;
    this._copyText(pgn, 'PGN copied.');
  };

  G.copyFen = function () {
    var viewer = this._viewer();
    var fen = viewer.fen();
    this.el.ioText.value = fen;
    this._copyText(fen, 'FEN copied.');
  };

  G._copyText = function (text, message) {
    var self = this;
    if (navigator.clipboard && global.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { self.toast(message); }, function () {
        self._legacyCopy(text, message);
      });
    } else {
      this._legacyCopy(text, message);
    }
  };

  G._legacyCopy = function (text, message) {
    this.el.ioText.value = text;
    this.el.ioText.focus();
    this.el.ioText.select();
    try { document.execCommand('copy'); this.toast(message); }
    catch (err) { this.toast('Text selected — press Cmd+C to copy.'); }
  };

  // ---- Rendering -----------------------------------------------------------

  G._renderAll = function () {
    this._renderBoard();
    this._renderMoveList();
    this._renderPlayerBars();
    this._renderCaptured();
    this._renderClocks();
    this._renderStatus();
    this._renderEvalBar();
    this._updateBoardEnabled();
    this._justMoved = false;
  };

  /** Advantage bar: white's share of the evaluation, smoothed for display. */
  G._renderEvalBar = function () {
    if (!this.el.evalFill) return;
    var pawns = this.ai.evaluate(this._viewer()) / 100;
    var share = 50 + 50 * (2 / (1 + Math.exp(-pawns / 3.2)) - 1);
    this.el.evalFill.style.width = Math.max(3, Math.min(97, share)).toFixed(1) + '%';
  };

  G._renderBoard = function () {
    var viewer = this._viewer();
    var check = viewer.inCheck() ? viewer._findKing(viewer.turn) : null;
    var last = null;
    if (this.viewIndex > 0) {
      var m = this.engine.gameMoves[this.viewIndex - 1];
      if (m) last = { from: m.from, to: m.to };
    }

    var animateMove = this._pendingMove;
    this._pendingMove = null;
    this.boardUI.setPosition({
      board: viewer.board,
      lastMove: last,
      check: check,
      move: animateMove,
      stagger: this._staggerNext
    });
    this._staggerNext = false;
  };

  G._updateBoardEnabled = function () {
    this.boardUI.setEnabled(this.active && this._atLatest() && !this.aiThinking && this._isHumanTurn());
  };

  G._renderMoveList = function () {
    var self = this;
    var moves = this.engine.gameMoves;
    this.el.moves.innerHTML = '';

    if (!moves.length) {
      this.el.moves.appendChild(this._movesEmptyState());
      this.el.moves.onclick = null;
      return;
    }

    for (var i = 0; i < moves.length; i += 2) {
      var tr = document.createElement('tr');
      var num = document.createElement('td');
      num.className = 'move-num';
      num.textContent = (i / 2 + 1) + '.';
      tr.appendChild(num);
      tr.appendChild(this._moveCell(moves[i], i + 1));
      tr.appendChild(moves[i + 1] ? this._moveCell(moves[i + 1], i + 2) : document.createElement('td'));
      this.el.moves.appendChild(tr);
    }

    var activeCell = this.el.moves.querySelector('[data-view="' + this.viewIndex + '"]');
    if (activeCell) {
      activeCell.classList.add('current');
      activeCell.scrollIntoView({ block: 'nearest' });
    }

    function clickHandler(ev) {
      var cell = ev.target.closest('[data-view]');
      if (cell) self.navigate(+cell.dataset.view);
    }
    this.el.moves.onclick = clickHandler;
  };

  /** Composed placeholder shown before the first move is played. */
  G._movesEmptyState = function () {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.className = 'moves-empty';
    td.colSpan = 3;

    var mark = document.createElement('div');
    mark.className = 'empty-mark';
    mark.textContent = '\u265F';

    var text = document.createElement('div');
    text.className = 'empty-text';
    text.textContent = 'No moves yet';

    var hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = this._isHumanTurn()
      ? 'Drag a piece or tap a square to begin.'
      : 'The computer opens this game.';

    td.appendChild(mark);
    td.appendChild(text);
    td.appendChild(hint);
    tr.appendChild(td);
    return tr;
  };

  G._moveCell = function (move, view) {
    var td = document.createElement('td');
    td.className = 'move-cell';
    td.dataset.view = view;
    td.textContent = move.san;
    td.title = move.fromAlg + '–' + move.toAlg;
    // Only the move just played animates in, so the list never re-flashes.
    if (this._justMoved && view === this.engine.gameMoves.length) td.classList.add('fresh');
    return td;
  };

  G._renderStatus = function () {
    if (!this._atLatest()) {
      if (this.viewIndex === 0) this.el.status.textContent = 'Starting position · Reviewing';
      else this.el.status.textContent = 'After ' + this.engine.gameMoves[this.viewIndex - 1].san + ' · Reviewing';
      this.el.evaluation.textContent = (this.viewIndex + 1) + ' / ' + (this.engine.gameMoves.length + 1) + ' positions';
      return;
    }
    if (this.result) {
      var winner = this.result.winner ? (this.result.winner === 'w' ? 'White wins' : 'Black wins') : 'Draw';
      this.el.status.textContent = winner;
      this.el.evaluation.textContent = this._reasonLabel(this.result.reason);
      return;
    }
    if (this.aiThinking) {
      this.el.status.textContent = 'Computer is thinking';
    } else {
      var color = this.engine.turn === 'w' ? 'White' : 'Black';
      this.el.status.textContent = (this.engine.inCheck() ? 'Check — ' : '') + color + ' to move';
    }
    this._renderStatusIndicators();
    var ev = this.ai.evaluate(this.engine) / 100;
    var evText = Math.abs(ev) < 0.05 ? 'Position is equal' : (ev > 0 ? 'White +' : 'Black +') + Math.abs(ev).toFixed(1);
    if (this.aiThinking && this.ai.nodes) evText += ' · ' + this.ai.nodes.toLocaleString() + ' nodes';
    this.el.evaluation.textContent = evText;
  };

  G._renderStatusIndicators = function () {
    var panel = this.el.statusPanel;
    var reviewing = !this._atLatest();
    if (this.el.thinking) {
      this.el.thinking.classList.toggle('on', !!this.aiThinking && !reviewing);
    }
    if (this.el.turnDot) {
      this.el.turnDot.classList.toggle('black', this.engine.turn === 'b');
      this.el.turnDot.classList.toggle('idle', !this.active || reviewing);
    }
    if (panel) {
      panel.classList.toggle('is-check', this.active && !reviewing && this.engine.inCheck());
      panel.classList.toggle('is-over', !this.active);
      panel.classList.toggle('is-thinking', !!this.aiThinking && !reviewing);
    }
  };

  G._reasonLabel = function (reason) {
    var labels = {
      checkmate: 'Checkmate', timeout: 'Time out', resignation: 'Resignation',
      stalemate: 'Stalemate', 'fifty-move': '50-move rule', threefold: 'Threefold repetition',
      insufficient: 'Insufficient material', agreement: 'Draw by agreement'
    };
    return labels[reason] || 'Game over';
  };

  G._nameForColor = function (color) {
    if (this.config.mode === 'human') return color === 'w' ? 'White' : 'Black';
    if (color === this.config.humanColor) return 'You';
    return 'Computer (Level ' + this.config.aiLevel + ')';
  };

  G._renderPlayerBars = function () {
    var bottom = this._colorAtBottom();
    var top = bottom === 'w' ? 'b' : 'w';
    this.el.nameBottom.textContent = this._nameForColor(bottom);
    this.el.nameTop.textContent = this._nameForColor(top);
    this.el.avatarBottom.textContent = bottom === 'w' ? '\u2659' : '\u265F';
    this.el.avatarTop.textContent = top === 'w' ? '\u2659' : '\u265F';
    this.el.avatarBottom.className = 'avatar ' + (bottom === 'w' ? 'white' : 'black');
    this.el.avatarTop.className = 'avatar ' + (top === 'w' ? 'white' : 'black');
  };

  G._renderCaptured = function () {
    var takenBy = { w: [], b: [] };
    for (var i = 0; i < this.engine.gameMoves.length; i++) {
      var m = this.engine.gameMoves[i];
      if (m.capture) takenBy[m.color].push(m.capture);
    }
    var order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    takenBy.w.sort(function (a, b) { return order[a] - order[b]; });
    takenBy.b.sort(function (a, b) { return order[a] - order[b]; });

    var bottom = this._colorAtBottom();
    var top = bottom === 'w' ? 'b' : 'w';
    this._fillCaptured(this.el.capturedBottom, takenBy[bottom], bottom === 'w' ? 'b' : 'w', takenBy);
    this._fillCaptured(this.el.capturedTop, takenBy[top], top === 'w' ? 'b' : 'w', takenBy);
  };

  G._fillCaptured = function (el, types, capturedColor, all) {
    var wasCount = el.childElementCount;
    el.innerHTML = '';
    for (var i = 0; i < types.length; i++) {
      var glyph = Pieces.glyphSpan(types[i], capturedColor, 'captured-glyph');
      if (this._justMoved && i === types.length - 1 && types.length > wasCount) glyph.classList.add('fresh');
      el.appendChild(glyph);
    }

    var whiteScore = 0, blackScore = 0;
    for (var w = 0; w < all.w.length; w++) whiteScore += MATERIAL[all.w[w]];
    for (var b = 0; b < all.b.length; b++) blackScore += MATERIAL[all.b[b]];
    var ownerColor = capturedColor === 'b' ? 'w' : 'b';
    var ownerScore = ownerColor === 'w' ? whiteScore : blackScore;
    var otherScore = ownerColor === 'w' ? blackScore : whiteScore;
    if (ownerScore > otherScore) {
      var adv = document.createElement('span');
      adv.className = 'material-adv';
      adv.textContent = '+' + (ownerScore - otherScore);
      el.appendChild(adv);
    }
  };

  // ---- Toast ---------------------------------------------------------------

  G.toast = function (message, error) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('error', !!error);
    el.classList.remove('hidden');
    global.clearTimeout(this._toastTimer);
    this._toastTimer = global.setTimeout(function () { el.classList.add('hidden'); }, 2800);
  };

  global.Game = Game;
})(window);
