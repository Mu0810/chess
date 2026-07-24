/*
 * pieces.js
 * Piece rendering helpers.
 *
 * We use the solid (filled) Unicode chess glyphs for BOTH colours and then
 * differentiate white vs black purely with CSS (fill colour + outline stroke).
 * Using the filled glyph for white as well (rather than the hollow glyph)
 * gives a consistent weight and lets an outline read clearly on any square.
 */
(function (global) {
  'use strict';

  // Solid glyphs (U+265A .. U+265F).
  var GLYPH = {
    k: '\u265A', // king
    q: '\u265B', // queen
    r: '\u265C', // rook
    b: '\u265D', // bishop
    n: '\u265E', // knight
    p: '\u265F'  // pawn
  };

  var NAME = {
    k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
  };

  /**
   * Build a DOM node for a piece.
   * @param {string} type  one of p n b r q k
   * @param {string} color 'w' | 'b'
   */
  function createPieceEl(type, color) {
    var el = document.createElement('div');
    el.className = 'piece ' + (color === 'w' ? 'white' : 'black');
    el.dataset.type = type;
    el.dataset.color = color;
    el.textContent = GLYPH[type];
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', (color === 'w' ? 'White ' : 'Black ') + NAME[type]);
    return el;
  }

  /** Small inline glyph (used for captured-piece trays and promotion picker). */
  function glyphSpan(type, color, extraClass) {
    var s = document.createElement('span');
    s.className = 'glyph ' + (color === 'w' ? 'white' : 'black') + (extraClass ? ' ' + extraClass : '');
    s.textContent = GLYPH[type];
    return s;
  }

  global.Pieces = {
    GLYPH: GLYPH,
    NAME: NAME,
    createPieceEl: createPieceEl,
    glyphSpan: glyphSpan
  };
})(window);
