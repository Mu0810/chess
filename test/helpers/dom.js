/*
 * A minimal DOM good enough to exercise the board renderer and the game
 * controller in Node. It implements only what the app actually touches, so a
 * missing method surfaces as a clear failure rather than a silent no-op.
 */
'use strict';

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { for (const n of names) this.set.add(n); }
  remove(...names) { for (const n of names) this.set.delete(n); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  get value() { return [...this.set].join(' '); }
}

class Style {
  constructor() { this.props = new Map(); }
  setProperty(name, value) { this.props.set(name, value); }
  removeProperty(name) { this.props.delete(name); }
  getPropertyValue(name) { return this.props.get(name) || ''; }
}

class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.classList = new ClassList(this);
    this.style = new Style();
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
    this._innerHTML = '';
    this.focused = false;
  }

  // The app assigns `className` directly in several places, so keep it and
  // classList in sync the way a real element does.
  set className(value) {
    this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this.classList.value; }

  set innerHTML(v) {
    this._innerHTML = v;
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] || null; }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  /** Fire handlers registered on this element (no bubbling). */
  dispatch(type, event = {}) {
    const list = this.listeners.get(type) || [];
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of [...list]) fn(ev);
    return ev;
  }

  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { this.focused = false; }
  select() {}
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 640, bottom: 640, width: 640, height: 640 }; }

  /** Supports the handful of selectors the app relies on. */
  querySelector(selector) {
    const byView = selector.match(/^\[data-view="?(\d+)"?\]$/);
    const byClass = selector.match(/^\.([\w-]+)$/);
    const walk = (node) => {
      for (const child of node.children) {
        if (byView && Number(child.dataset.view) === Number(byView[1])) return child;
        if (byClass && child.classList.contains(byClass[1])) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(selector) {
    const byClass = selector.match(/^\.([\w-]+)$/);
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (byClass && child.classList.contains(byClass[1])) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  closest(selector) {
    const byClass = selector.match(/^\.([\w-]+)$/);
    let node = this;
    while (node) {
      if (byClass && node.classList.contains(byClass[1])) return node;
      if (selector === '[data-view]' && node.dataset.view !== undefined) return node;
      node = node.parentNode;
    }
    return null;
  }
  get allDescendants() {
    const out = [];
    const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

class LocalStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/**
 * Install a fake DOM onto globalThis and load the app's browser scripts.
 * Returns handles for driving and inspecting the app.
 */
function installDom({ ids = [], withWorker = false, keepStorage = false } = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    documentElement: new Element('html'),
    body: new Element('body'),
    getElementById(id) {
      if (!elements.has(id)) {
        const el = new Element('div', id);
        el.ownerDocument = document;
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement(tag) {
      const el = new Element(tag);
      el.ownerDocument = document;
      return el;
    },
    elementFromPoint: () => null,
    execCommand: () => true,
    addEventListener() {},
    removeEventListener() {}
  };

  for (const id of ids) document.getElementById(id);

  const workerCalls = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      this.onerror = null;
      workerCalls.push(url);
      FakeWorker.instances.push(this);
    }
    postMessage(data) { this.posted.push(data); }
    terminate() { this.terminated = true; }
    get posted() { return (this._posted = this._posted || []); }
    /** Simulate the worker replying. */
    reply(data) { if (this.onmessage) this.onmessage({ data }); }
    fail(message) { if (this.onerror) this.onerror({ message, preventDefault() {} }); }
  }
  FakeWorker.instances = [];

  // Node 21+ ships some of these as read-only accessors on globalThis, so a
  // plain assignment would throw under strict mode. Define them instead.
  const setGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, {
      value, writable: true, configurable: true, enumerable: true
    });
  };

  setGlobal('window', globalThis);
  setGlobal('document', document);
  setGlobal('navigator', { clipboard: null });
  setGlobal('isSecureContext', false);
  setGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  setGlobal('confirm', () => { throw new Error('window.confirm must not be used'); });
  setGlobal('alert', () => { throw new Error('window.alert must not be used'); });

  // Storage belongs to the origin, not the page, so it survives a "reload"
  // unless a test explicitly wants a clean slate.
  if (!(globalThis.localStorage instanceof LocalStorage)) setGlobal('localStorage', new LocalStorage());
  if (!keepStorage) globalThis.localStorage.clear();

  if (withWorker) setGlobal('Worker', FakeWorker);
  else if ('Worker' in globalThis) setGlobal('Worker', undefined);

  const load = () => {
    for (const mod of ['pieces', 'engine', 'ai', 'sounds', 'ui', 'game']) {
      delete require.cache[require.resolve(`../../js/${mod}.js`)];
      require(`../../js/${mod}.js`);
    }
  };
  load();

  return { document, elements, Element, FakeWorker, workerCalls };
}

/** IDs the controller expects to find in the page. */
const APP_IDS = [
  'board', 'board-wrap', 'board-overlay', 'status-line', 'status-panel', 'eval-line', 'eval-bar',
  'eval-fill', 'turn-dot', 'thinking', 'moves-body', 'clock-top', 'clock-bottom', 'player-top',
  'player-bottom', 'name-top', 'name-bottom', 'avatar-top', 'avatar-bottom', 'captured-top',
  'captured-bottom', 'io-text', 'celebration', 'toast', 'promo-modal', 'promo-box',
  'gameover-modal', 'gameover-result', 'gameover-detail', 'gameover-badge', 'gameover-review',
  'gameover-newgame', 'confirm-modal', 'confirm-title', 'confirm-detail', 'confirm-ok',
  'confirm-cancel', 'btn-flip', 'btn-takeback', 'btn-draw', 'btn-resign', 'btn-new-game',
  'nav-first', 'nav-prev', 'nav-next', 'nav-last', 'btn-copy-pgn', 'btn-copy-fen',
  'btn-load-fen', 'btn-load-pgn', 'sr-status'
];

/** Create a Game with timers stopped, ready for assertions. */
function newGame(opts = {}) {
  const harness = installDom({ ids: APP_IDS, ...opts });
  const game = new globalThis.Game();
  game.sounds.enabled = false;
  return { game, ...harness };
}

/** Stop every timer a Game may have started so tests exit cleanly. */
function disposeGame(game) {
  clearInterval(game._clockInterval);
  clearTimeout(game._toastTimer);
  clearTimeout(game.aiTimer);
  clearTimeout(game._confettiTimer);
  clearTimeout(game._saveTimer);
  if (game.worker && game.worker.terminate) game.worker.terminate();
}

/**
 * Assert the rendered pieces match the engine's board exactly. This is the
 * invariant that protects the animated renderer against drift.
 */
function boardMatchesDom(game) {
  const board = game.boardUI.board;
  const nodes = game.boardUI.piecesEl.children.filter((el) => !el.classList.contains('captured-out'));
  const occupied = board.filter(Boolean).length;
  if (nodes.length !== occupied) {
    return `rendered ${nodes.length} pieces but board has ${occupied}`;
  }
  for (const el of nodes) {
    const piece = board[Number(el.dataset.idx)];
    if (!piece) return `piece rendered on empty square ${el.dataset.idx}`;
    if (piece.type !== el.dataset.type || piece.color !== el.dataset.color) {
      return `square ${el.dataset.idx} shows ${el.dataset.color}${el.dataset.type} but board has ${piece.color}${piece.type}`;
    }
  }
  return null;
}

module.exports = { installDom, newGame, disposeGame, boardMatchesDom, APP_IDS, Element };
