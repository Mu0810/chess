/*
 * worker.js - runs the engine search off the main thread.
 *
 * The page posts { id, fen, level } and gets back { id, move, nodes } or
 * { id, error }. The id lets the controller discard results that arrive after
 * a takeback, a new game, or any other change of position.
 *
 * Paths in importScripts resolve against this file, so the worker picks up the
 * same engine and search code the page uses.
 */
'use strict';

importScripts('engine.js', 'ai.js');

var ai = new ChessAI();

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'search') return;

  try {
    var position = new Chess(data.fen);
    var move = ai.chooseMove(position, data.level);
    self.postMessage({
      type: 'result',
      id: data.id,
      move: move,
      nodes: ai.nodes
    });
  } catch (err) {
    self.postMessage({
      type: 'result',
      id: data.id,
      error: (err && err.message) || 'search failed'
    });
  }
};
