/**
 * Eingabe aus vier Quellen, zusammengefuehrt in einen einzigen Zustand:
 * Tastatur, Bildschirmsteuerung, Lenkrad/Gamepad und Handy-Neigung.
 *
 * Jede Quelle schreibt in ihren eigenen Block. Beim Zusammenfuehren gewinnt
 * pro Achse der staerkste Ausschlag - so kann man jederzeit zwischen Neigung,
 * Touch und Lenkrad wechseln, ohne etwas umzustellen.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function emptyAxes() {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0 };
}

export class InputManager {
  constructor(options = {}) {
    this.enabled = { keyboard: true, touch: true, gamepad: true, tilt: false };
    this.sources = {
      keyboard: emptyAxes(),
      touch: emptyAxes(),
      gamepad: emptyAxes(),
      tilt: emptyAxes(),
    };

    // Ereignisse werden gezaehlt, nicht nur gesetzt: bei niedriger Bildrate
    // faellt sonst jeder zweite Tastendruck unter den Tisch.
    this.state = { ...emptyAxes(), shiftUp: 0, shiftDown: 0 };
    this.events = { camera: 0, reset: 0, pause: 0, toTrack: 0 };

    this.keys = new Set();
    this.keySteer = 0;

    // Lenkrad / Gamepad
    this.gamepadIndex = null;
    this.gamepadName = '';
    this.mapping = options.mapping || {
      steerAxis: 0,
      throttleAxis: null,
      brakeAxis: null,
      throttleButton: 7,
      brakeButton: 6,
      shiftUpButton: 5,
      shiftDownButton: 4,
      invertPedals: true,
    };
    this.calibration = null;
    this._prevButtons = [];

    // Neigung
    this.tilt = {
      available: false,
      permission: 'unknown',
      raw: 0,
      center: 0,
      range: options.tiltRange || 28, // Grad fuer vollen Einschlag
      deadzone: 1.5,
    };

    this.onCalibrationProgress = null;
    this._bindKeyboard();
    this._bindGamepad();
  }

  // ---------------------------------------------------------------- Tastatur
  _bindKeyboard() {
    const down = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'c') this.events.camera++;
      if (k === 'r') this.events.reset++;
      if (k === 'escape' || k === 'p') this.events.pause++;
      if (k === 't') this.events.toTrack++;
      if (k === 'e' || k === 'shift') this.state.shiftUp++;
      if (k === 'q' || k === 'control') this.state.shiftDown++;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    const up = (e) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
  }

  _updateKeyboard(dt) {
    const k = this.keys;
    const a = this.sources.keyboard;
    a.throttle = k.has('arrowup') || k.has('w') ? 1 : 0;
    a.brake = k.has('arrowdown') || k.has('s') ? 1 : 0;
    a.handbrake = k.has(' ') ? 1 : 0;

    // Lenken per Taste muss rampen, sonst ist es unfahrbar
    const want = (k.has('arrowleft') || k.has('a') ? -1 : 0) + (k.has('arrowright') || k.has('d') ? 1 : 0);
    const rate = want === 0 ? 6.5 : 3.2;
    if (want === 0) {
      const back = rate * dt;
      this.keySteer = Math.abs(this.keySteer) <= back ? 0 : this.keySteer - Math.sign(this.keySteer) * back;
    } else {
      this.keySteer = clamp(this.keySteer + want * rate * dt, -1, 1);
    }
    a.steer = this.keySteer;
  }

  // ------------------------------------------------------------ Touch/Maus
  /** Wird von der Bildschirmsteuerung aufgerufen. */
  setTouchAxis(name, value) {
    if (name in this.sources.touch) this.sources.touch[name] = clamp(value, -1, 1);
  }
  clearTouch() {
    this.sources.touch = emptyAxes();
  }

  // ------------------------------------------------------- Lenkrad/Gamepad
  _bindGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.gamepadName = e.gamepad.id;
      this._autoDetectWheel(e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.gamepadName = '';
      }
    });
  }

  /** Typische Lenkraeder haben getrennte Pedalachsen statt Trigger-Tasten. */
  _autoDetectWheel(pad) {
    const id = (pad.id || '').toLowerCase();
    const isWheel = /wheel|g25|g27|g29|g920|g923|t150|t300|tmx|thrustmaster|fanatec|logitech|driving/.test(id);
    if (isWheel) {
      this.mapping = {
        steerAxis: 0,
        throttleAxis: pad.axes.length > 2 ? 2 : 1,
        brakeAxis: pad.axes.length > 2 ? 1 : null,
        throttleButton: null,
        brakeButton: null,
        shiftUpButton: 5,
        shiftDownButton: 4,
        invertPedals: true,
      };
    }
  }

  /**
   * Startet die Kalibrierung. Der Spieler bewegt nacheinander Lenkung, Gas und
   * Bremse; es wird jeweils die Achse mit dem groessten Ausschlag genommen.
   */
  startCalibration(steps = ['steer', 'throttle', 'brake']) {
    const pad = this._pad();
    if (!pad) return false;
    this.calibration = {
      steps,
      index: 0,
      base: Array.from(pad.axes),
      best: null,
      samples: 0,
    };
    return true;
  }

  cancelCalibration() {
    this.calibration = null;
  }

  _updateCalibration(pad) {
    const cal = this.calibration;
    const step = cal.steps[cal.index];
    cal.samples++;
    let bestAxis = -1;
    let bestDelta = 0.25; // Mindestausschlag, damit Rauschen nicht zaehlt
    for (let i = 0; i < pad.axes.length; i++) {
      const d = Math.abs(pad.axes[i] - cal.base[i]);
      if (d > bestDelta) {
        bestDelta = d;
        bestAxis = i;
      }
    }
    if (bestAxis >= 0) {
      cal.best = { axis: bestAxis, delta: pad.axes[bestAxis] - cal.base[bestAxis], base: cal.base[bestAxis] };
    }
    // Nach kurzer Haltezeit uebernehmen
    if (cal.best && cal.samples > 30) {
      const { axis, delta, base } = cal.best;
      if (step === 'steer') this.mapping.steerAxis = axis;
      if (step === 'throttle') {
        this.mapping.throttleAxis = axis;
        this.mapping.throttleButton = null;
        this.mapping.throttleBase = base;
        this.mapping.throttleSign = Math.sign(delta);
      }
      if (step === 'brake') {
        this.mapping.brakeAxis = axis;
        this.mapping.brakeButton = null;
        this.mapping.brakeBase = base;
        this.mapping.brakeSign = Math.sign(delta);
      }
      cal.index++;
      cal.best = null;
      cal.samples = 0;
      cal.base = Array.from(pad.axes);
      if (cal.index >= cal.steps.length) {
        this.calibration = null;
        if (this.onCalibrationProgress) this.onCalibrationProgress(null);
        return;
      }
    }
    if (this.onCalibrationProgress) {
      this.onCalibrationProgress({ step: cal.steps[cal.index], index: cal.index, total: cal.steps.length });
    }
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.gamepadIndex !== null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        this.gamepadName = p.id;
        return p;
      }
    }
    return null;
  }

  _updateGamepad() {
    const a = this.sources.gamepad;
    const pad = this._pad();
    if (!pad) {
      this.sources.gamepad = emptyAxes();
      return;
    }
    if (this.calibration) {
      this._updateCalibration(pad);
      this.sources.gamepad = emptyAxes();
      return;
    }

    const m = this.mapping;
    const axis = (i) => (i === null || i === undefined || !(i in pad.axes) ? 0 : pad.axes[i]);

    // Lenkung mit kleiner Totzone um die Mitte
    let steer = axis(m.steerAxis);
    if (Math.abs(steer) < 0.035) steer = 0;
    a.steer = clamp(steer, -1, 1);

    const pedal = (axisIndex, buttonIndex, base, sign) => {
      if (axisIndex !== null && axisIndex !== undefined) {
        const raw = axis(axisIndex);
        if (base !== undefined && sign) {
          // aus der Kalibrierung: von der Ruhelage weg = Pedal getreten
          return clamp(((raw - base) * sign) / 2, 0, 1);
        }
        // Standard bei Lenkraedern: Ruhelage +1, voll getreten -1
        return clamp(m.invertPedals ? (1 - raw) / 2 : (raw + 1) / 2, 0, 1);
      }
      if (buttonIndex !== null && pad.buttons[buttonIndex]) {
        return clamp(pad.buttons[buttonIndex].value, 0, 1);
      }
      return 0;
    };

    a.throttle = pedal(m.throttleAxis, m.throttleButton, m.throttleBase, m.throttleSign);
    a.brake = pedal(m.brakeAxis, m.brakeButton, m.brakeBase, m.brakeSign);

    // Schaltwippen flankengesteuert
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i) => i !== null && pressed[i] && !this._prevButtons[i];
    if (edge(m.shiftUpButton)) this.state.shiftUp++;
    if (edge(m.shiftDownButton)) this.state.shiftDown++;
    if (edge(1)) this.events.camera++;
    if (edge(3)) this.events.reset++;
    if (edge(9)) this.events.pause++;
    a.handbrake = pad.buttons[0]?.pressed ? 1 : 0;
    this._prevButtons = pressed;
  }

  // ------------------------------------------------------------- Neigung
  /** Muss aus einer Nutzeraktion heraus aufgerufen werden (Vorgabe von iOS). */
  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      this.tilt.permission = 'unsupported';
      return false;
    }
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        this.tilt.permission = res;
        if (res !== 'granted') return false;
      } catch {
        this.tilt.permission = 'denied';
        return false;
      }
    } else {
      this.tilt.permission = 'granted';
    }
    if (!this._tiltBound) {
      window.addEventListener('deviceorientation', (e) => this._onOrientation(e));
      this._tiltBound = true;
    }
    this.enabled.tilt = true;
    return true;
  }

  disableTilt() {
    this.enabled.tilt = false;
    this.sources.tilt = emptyAxes();
  }

  _onOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    this.tilt.available = true;
    // Welcher Winkel die Lenkachse ist, haengt an der Bildschirmausrichtung.
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let value;
    if (angle === 90) value = e.beta;
    else if (angle === 270 || angle === -90) value = -e.beta;
    else if (angle === 180) value = -e.gamma;
    else value = e.gamma;
    this.tilt.raw = value ?? 0;
  }

  /** Aktuelle Haltung als Geradeausstellung uebernehmen. */
  calibrateTilt() {
    this.tilt.center = this.tilt.raw;
  }

  _updateTilt() {
    if (!this.enabled.tilt || !this.tilt.available) {
      this.sources.tilt = emptyAxes();
      return;
    }
    let d = this.tilt.raw - this.tilt.center;
    const dz = this.tilt.deadzone;
    if (Math.abs(d) < dz) d = 0;
    else d = d - Math.sign(d) * dz;
    const v = clamp(d / (this.tilt.range - dz), -1, 1);
    // Leicht progressiv: kleine Neigung lenkt fein, grosse geht bis Anschlag
    this.sources.tilt.steer = Math.sign(v) * v * v * 0.55 + v * 0.45;
  }

  // ------------------------------------------------------------ Zusammenfuehren
  update(dt) {
    this._updateKeyboard(dt);
    this._updateGamepad();
    this._updateTilt();

    const pick = (key, signed) => {
      let best = 0;
      for (const [name, axes] of Object.entries(this.sources)) {
        if (name === 'tilt' && !this.enabled.tilt) continue;
        const v = axes[key];
        if (signed ? Math.abs(v) > Math.abs(best) : v > best) best = v;
      }
      return best;
    };

    this.state.steer = clamp(pick('steer', true), -1, 1);
    this.state.throttle = clamp(pick('throttle', false), 0, 1);
    this.state.brake = clamp(pick('brake', false), 0, 1);
    this.state.handbrake = clamp(pick('handbrake', false), 0, 1);
    this.state.clutch = clamp(pick('clutch', false), 0, 1);
    return this.state;
  }

  /** Flankenereignisse abholen und zuruecksetzen. */
  consume() {
    const out = {
      shiftUp: this.state.shiftUp,
      shiftDown: this.state.shiftDown,
      ...this.events,
    };
    this.state.shiftUp = 0;
    this.state.shiftDown = 0;
    this.events.camera = 0;
    this.events.reset = 0;
    this.events.pause = 0;
    this.events.toTrack = 0;
    return out;
  }

  get activeDevice() {
    if (this.enabled.tilt && this.tilt.available) return 'Neigung';
    if (this.gamepadIndex !== null) return this.gamepadName.slice(0, 28) || 'Lenkrad';
    return 'Tastatur / Touch';
  }
}
