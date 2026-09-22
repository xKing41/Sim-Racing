/**
 * Motor- und Fahrgeraeusche, komplett synthetisiert.
 *
 * Der Motorklang entsteht aus mehreren Saegezahn-Oszillatoren auf der
 * Zuendfrequenz und ihren Oberwellen. Ein Tiefpass, dessen Grenzfrequenz mit
 * Last und Drehzahl oeffnet, macht den Unterschied zwischen Schub und Zug -
 * das ist der Teil, an dem man Gaswegnehmen wirklich hoert.
 */

const HARMONICS = [
  { mult: 0.5, gain: 0.34, type: 'sawtooth' },
  { mult: 1.0, gain: 1.0, type: 'sawtooth' },
  { mult: 1.5, gain: 0.26, type: 'square' },
  { mult: 2.0, gain: 0.42, type: 'sawtooth' },
  { mult: 3.0, gain: 0.16, type: 'sawtooth' },
];

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    // leicht gefaerbtes Rauschen klingt natuerlicher als weisses
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.2;
  }
  return buf;
}

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVolume = 0.65;
  }

  /** Muss aus einer Nutzeraktion heraus gestartet werden. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(ctx.destination);

    // leichte Kompression, damit Vollgas nicht uebersteuert
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    comp.connect(this.master);
    this.bus = comp;

    // --- Motor ------------------------------------------------------------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.9;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.bus);

    this.oscillators = HARMONICS.map((h) => {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      osc.connect(g);
      g.connect(this.engineGain);
      osc.start();
      return { osc, gain: g, meta: h };
    });

    // Ansauggeraeusch: gefiltertes Rauschen, oeffnet mit dem Gas
    const nb = noiseBuffer(ctx);
    this.intake = ctx.createBufferSource();
    this.intake.buffer = nb;
    this.intake.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 700;
    this.intakeFilter.Q.value = 1.1;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.bus);
    this.intake.start();

    // --- Reifen -----------------------------------------------------------
    this.squeal = ctx.createBufferSource();
    this.squeal.buffer = nb;
    this.squeal.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1500;
    this.squealFilter.Q.value = 7;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.bus);
    this.squeal.start();

    // --- Fahrtwind und Untergrund -----------------------------------------
    this.wind = ctx.createBufferSource();
    this.wind.buffer = nb;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.bus);
    this.wind.start();

    this.rumble = ctx.createBufferSource();
    this.rumble.buffer = nb;
    this.rumble.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 180;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.bus);
    this.rumble.start();

    this.ready = true;
    this._lastGear = null;
  }

  stop() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  setVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) {
      this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  /** Kurzer Knall beim Hochschalten. */
  blip() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g);
    g.connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /**
   * @param {object} tel Telemetrie aus Vehicle.telemetry()
   * @param {object} extra { slip, rumble, offTrack, airborne }
   */
  update(tel, extra = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const smooth = 0.035;

    // Zuendfrequenz eines V8: 4 Zuendungen pro Kurbelwellenumdrehung
    const baseFreq = Math.max(18, (tel.rpm / 60) * 4);
    for (const { osc, meta } of this.oscillators) {
      osc.frequency.setTargetAtTime(baseFreq * meta.mult, t, smooth);
    }

    const load = tel.throttle;
    const rpmNorm = Math.min(1, tel.rpm / 8600);

    // Lautstaerke: Grundpegel plus Last
    let gain = 0.06 + rpmNorm * 0.1 + load * 0.2;
    if (tel.shifting) gain *= 0.45;
    if (tel.limiter > 0.5) gain *= 0.7 + 0.3 * Math.sin(t * 90);
    this.engineGain.gain.setTargetAtTime(gain, t, smooth);

    // Filter oeffnet mit Last - Schub klingt dumpf, Zug klingt hart
    const cutoff = 420 + rpmNorm * 2600 + load * 3200;
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, smooth);

    this.intakeGain.gain.setTargetAtTime(load * (0.05 + rpmNorm * 0.12), t, smooth);
    this.intakeFilter.frequency.setTargetAtTime(500 + rpmNorm * 2200, t, smooth);

    // Reifenquietschen ab dem Kraftmaximum
    const slip = Math.max(0, (extra.slip || 0) - 1);
    const squeal = Math.min(1, slip * 0.9) * Math.min(1, tel.speedKmh / 25);
    this.squealGain.gain.setTargetAtTime(squeal * 0.16, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(1100 + squeal * 900 + tel.speedKmh * 2.2, t, 0.06);

    // Fahrtwind
    const windLevel = Math.min(1, tel.speedKmh / 260);
    this.windGain.gain.setTargetAtTime(windLevel * windLevel * 0.1, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + tel.speedKmh * 4, t, 0.1);

    // Curbs und Untergrund
    const rumble = (extra.rumble || 0) * Math.min(1, tel.speedKmh / 40);
    this.rumbleGain.gain.setTargetAtTime(extra.airborne ? 0 : rumble * 0.3, t, 0.04);

    if (this._lastGear !== null && tel.gearIndex > this._lastGear && tel.gearIndex > 2) this.blip();
    this._lastGear = tel.gearIndex;
  }
}
