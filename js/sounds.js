/*
 * sounds.js  -  Lightweight synthesized sound effects (Web Audio API).
 * No audio files required. The AudioContext is created lazily on first use
 * (browsers require a user gesture before audio can start).
 */
(function (global) {
  'use strict';

  function Sounds() {
    this.enabled = true;
    this.ctx = null;
  }

  Sounds.prototype._ensure = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  };

  Sounds.prototype._tone = function (freq, start, dur, gain, type) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.02);
  };

  Sounds.prototype._click = function (start, gain, freq) {
    // Percussive "clack": short filtered noise burst.
    var ctx = this.ctx;
    var len = Math.floor(ctx.sampleRate * 0.03);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || 1800;
    bp.Q.value = 0.8;
    var g = ctx.createGain();
    g.gain.value = gain || 0.5;
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime + start);
  };

  Sounds.prototype.play = function (name) {
    if (!this.enabled) return;
    var ctx = this._ensure();
    if (!ctx) return;
    switch (name) {
      case 'move':
        this._click(0, 0.35, 1500);
        break;
      case 'capture':
        this._click(0, 0.5, 1000);
        this._tone(180, 0, 0.08, 0.12, 'sawtooth');
        break;
      case 'castle':
        this._click(0, 0.4, 1400);
        this._click(0.09, 0.35, 1400);
        break;
      case 'check':
        this._tone(880, 0, 0.12, 0.14, 'sine');
        this._tone(1320, 0.1, 0.12, 0.1, 'sine');
        break;
      case 'promote':
        this._tone(660, 0, 0.1, 0.12, 'triangle');
        this._tone(990, 0.09, 0.14, 0.12, 'triangle');
        break;
      case 'start':
        this._tone(523, 0, 0.12, 0.1, 'sine');
        this._tone(784, 0.1, 0.16, 0.1, 'sine');
        break;
      case 'end':
        this._tone(392, 0, 0.18, 0.12, 'sine');
        this._tone(311, 0.16, 0.28, 0.12, 'sine');
        break;
      case 'illegal':
        this._tone(160, 0, 0.12, 0.12, 'square');
        break;
      default:
        this._click(0, 0.35, 1500);
    }
  };

  global.Sounds = Sounds;
})(window);
