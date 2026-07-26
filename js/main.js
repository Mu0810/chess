/* main.js - Modal controls, settings, keyboard shortcuts, and app startup. */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function selectedValue(groupId) {
    var active = byId(groupId).querySelector('.seg.active');
    return active ? active.dataset.value : null;
  }

  function selectValue(groupId, value) {
    var buttons = byId(groupId).querySelectorAll('.seg');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.value === String(value));
    }
  }

  function bindSegmented(groupId, onChange) {
    byId(groupId).addEventListener('click', function (ev) {
      var btn = ev.target.closest('.seg');
      if (!btn) return;
      var siblings = btn.parentNode.querySelectorAll('.seg');
      for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('active');
      btn.classList.add('active');
      if (onChange) onChange(btn.dataset.value);
    });
  }

  function openModal(el) { el.classList.remove('hidden'); }
  function closeModal(el) { el.classList.add('hidden'); }

  var newGameModal = byId('newgame-modal');
  var settingsModal = byId('settings-modal');
  var confirmModal = byId('confirm-modal');
  var game = new Game();
  globalThis.kiroChess = game;

  // ---- New game dialog -----------------------------------------------------

  function updateModeFields(mode) {
    byId('group-difficulty').classList.toggle('hidden', mode !== 'ai');
    byId('group-color').classList.toggle('hidden', mode !== 'ai');
  }

  bindSegmented('opt-mode', updateModeFields);
  bindSegmented('opt-difficulty');
  bindSegmented('opt-color');
  bindSegmented('opt-time');
  updateModeFields(selectedValue('opt-mode'));

  byId('btn-new-game').addEventListener('click', function () { openModal(newGameModal); });
  byId('newgame-cancel').addEventListener('click', function () { closeModal(newGameModal); });
  byId('newgame-start').addEventListener('click', function () {
    var mode = selectedValue('opt-mode');
    var color = selectedValue('opt-color');
    if (color === 'random') color = Math.random() < 0.5 ? 'w' : 'b';
    var tc = selectedValue('opt-time').split(',').map(Number);
    game.start({
      mode: mode,
      aiLevel: +selectedValue('opt-difficulty'),
      humanColor: color,
      baseSeconds: tc[0],
      increment: tc[1]
    });
    closeModal(newGameModal);
  });

  // ---- Settings ------------------------------------------------------------

  var stored = {};
  try { stored = JSON.parse(localStorage.getItem('kiro-chess-settings') || '{}'); }
  catch (err) { stored = {}; }

  var settings = {
    theme: stored.theme || 'green',
    sound: stored.sound !== 'off' ? 'on' : 'off',
    hints: stored.hints !== 'off' ? 'on' : 'off'
  };

  function applySettings() {
    document.body.dataset.theme = settings.theme;
    document.body.classList.toggle('hide-hints', settings.hints === 'off');
    game.sounds.enabled = settings.sound === 'on';
    selectValue('opt-theme', settings.theme);
    selectValue('opt-sound', settings.sound);
    selectValue('opt-hints', settings.hints);
    try { localStorage.setItem('kiro-chess-settings', JSON.stringify(settings)); }
    catch (err) { /* storage can be unavailable under strict file:// settings */ }
  }

  bindSegmented('opt-theme', function (value) { settings.theme = value; applySettings(); });
  bindSegmented('opt-sound', function (value) { settings.sound = value; applySettings(); });
  bindSegmented('opt-hints', function (value) { settings.hints = value; applySettings(); });
  applySettings();

  byId('btn-settings').addEventListener('click', function () { openModal(settingsModal); });
  byId('settings-close').addEventListener('click', function () { closeModal(settingsModal); });

  // Clicking outside a standard modal closes it (never closes a completed
  // game's result modal, which has explicit actions).
  newGameModal.addEventListener('pointerdown', function (ev) {
    if (ev.target === newGameModal) closeModal(newGameModal);
  });
  settingsModal.addEventListener('pointerdown', function (ev) {
    if (ev.target === settingsModal) closeModal(settingsModal);
  });

  // ---- Keyboard conveniences ----------------------------------------------

  document.addEventListener('keydown', function (ev) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;

    // The confirmation dialog owns its own keys (Enter / Escape).
    if (confirmModal && !confirmModal.classList.contains('hidden')) return;

    if (ev.key === 'Escape') {
      closeModal(newGameModal);
      closeModal(settingsModal);
      return;
    }
    if (!newGameModal.classList.contains('hidden') || !settingsModal.classList.contains('hidden')) return;

    if (ev.key === 'ArrowLeft') { ev.preventDefault(); game.navigate(game.viewIndex - 1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); game.navigate(game.viewIndex + 1); }
    else if (ev.key.toLowerCase() === 'f') byId('btn-flip').click();
    else if (ev.key.toLowerCase() === 'n') openModal(newGameModal);
  });
})();
