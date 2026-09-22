/**
 * Bildschirmsteuerung fuer Touchgeraete.
 *
 * Drei Belegungen:
 *   'tasten'  - Pfeile links, Pedale rechts
 *   'schieber'- waagerechter Lenkstreifen links, Pedale rechts
 *   'neigung' - Lenkung ueber die Neigung des Geraets, nur Pedale auf dem Schirm
 *
 * Alle Flaechen reagieren auf Pointer-Ereignisse und merken sich die Zeiger-ID,
 * damit mehrere Finger gleichzeitig funktionieren (Gas und Lenken zugleich).
 */

export const TOUCH_LAYOUTS = ['tasten', 'schieber', 'neigung'];
export const TOUCH_LABELS = {
  tasten: 'Tasten',
  schieber: 'Lenkstreifen',
  neigung: 'Neigung',
};

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export class TouchControls {
  constructor(container, input) {
    this.input = input;
    this.layout = 'tasten';
    this.visible = false;
    this.steerReturn = 0;

    this.root = el('div', 'touch', container);
    this.root.style.display = 'none';

    // --- Lenkbereich links ------------------------------------------------
    this.steerZone = el('div', 'touch-steer-zone', this.root);
    this.btnLeft = el('div', 'touch-btn touch-left', this.steerZone);
    el('span', '', this.btnLeft, '◀');
    this.btnRight = el('div', 'touch-btn touch-right', this.steerZone);
    el('span', '', this.btnRight, '▶');

    this.slider = el('div', 'touch-slider', this.root);
    this.sliderTrack = el('div', 'touch-slider-track', this.slider);
    this.sliderKnob = el('div', 'touch-slider-knob', this.slider);
    this.slider.style.display = 'none';

    // --- Pedale rechts ----------------------------------------------------
    this.pedalZone = el('div', 'touch-pedals', this.root);
    this.btnBrake = el('div', 'touch-btn touch-brake', this.pedalZone);
    el('span', '', this.btnBrake, 'BREMSE');
    this.btnThrottle = el('div', 'touch-btn touch-throttle', this.pedalZone);
    el('span', '', this.btnThrottle, 'GAS');

    // --- Nebenfunktionen --------------------------------------------------
    this.sideBar = el('div', 'touch-side', this.root);
    this.btnReset = el('div', 'touch-mini touch-mini-reset', this.sideBar, '↺');
    this.btnCamera = el('div', 'touch-mini', this.sideBar, '▣');
    this.btnHandbrake = el('div', 'touch-mini', this.sideBar, 'HB');
    this.btnShiftDown = el('div', 'touch-mini', this.sideBar, '−');
    this.btnShiftUp = el('div', 'touch-mini', this.sideBar, '+');

    this._bindHold(this.btnLeft, (on) => this._setSteerKey(-1, on));
    this._bindHold(this.btnRight, (on) => this._setSteerKey(1, on));
    this._bindHold(this.btnThrottle, (on, p) => input.setTouchAxis('throttle', on ? this._pressure(p, this.btnThrottle) : 0));
    this._bindHold(this.btnBrake, (on, p) => input.setTouchAxis('brake', on ? this._pressure(p, this.btnBrake) : 0));
    this._bindHold(this.btnHandbrake, (on) => input.setTouchAxis('handbrake', on ? 1 : 0));
    this._bindTap(this.btnReset, () => { input.events.reset++; });
    this._bindTap(this.btnCamera, () => { input.events.camera++; });
    this._bindTap(this.btnShiftUp, () => { input.state.shiftUp++; });
    this._bindTap(this.btnShiftDown, () => { input.state.shiftDown++; });
    this._bindSlider();

    this.steerKey = 0;
    this.steerValue = 0;
  }

  /** Wie weit oben im Pedal gedrueckt wird, steuert wie viel Gas/Bremse. */
  _pressure(ev, node) {
    if (!ev) return 1;
    const r = node.getBoundingClientRect();
    const rel = 1 - (ev.clientY - r.top) / r.height;
    return Math.max(0.25, Math.min(1, 0.45 + rel * 0.75));
  }

  _bindHold(node, cb) {
    let pointerId = null;
    const start = (e) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      node.setPointerCapture(e.pointerId);
      node.classList.add('active');
      cb(true, e);
      e.preventDefault();
    };
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      cb(true, e);
    };
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      node.classList.remove('active');
      cb(false, e);
    };
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('lostpointercapture', end);
  }

  _bindTap(node, cb) {
    node.addEventListener('pointerdown', (e) => {
      node.classList.add('active');
      cb();
      e.preventDefault();
    });
    const off = () => node.classList.remove('active');
    node.addEventListener('pointerup', off);
    node.addEventListener('pointercancel', off);
  }

  _bindSlider() {
    let pointerId = null;
    const set = (e) => {
      const r = this.slider.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      const v = Math.max(-1, Math.min(1, (rel - 0.5) * 2.15));
      this.steerValue = v;
      this.sliderKnob.style.left = `${50 + v * 46}%`;
    };
    this.slider.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      this.slider.setPointerCapture(e.pointerId);
      set(e);
      e.preventDefault();
    });
    this.slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) set(e);
    });
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.steerValue = 0;
      this.sliderKnob.style.left = '50%';
    };
    this.slider.addEventListener('pointerup', end);
    this.slider.addEventListener('pointercancel', end);
  }

  _setSteerKey(dir, on) {
    if (on) this.steerKey = dir;
    else if (this.steerKey === dir) this.steerKey = 0;
  }

  setLayout(layout) {
    if (!TOUCH_LAYOUTS.includes(layout)) return;
    this.layout = layout;
    this.steerZone.style.display = layout === 'tasten' ? '' : 'none';
    this.slider.style.display = layout === 'schieber' ? '' : 'none';
    this.steerKey = 0;
    this.steerValue = 0;
    this.input.setTouchAxis('steer', 0);
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
    if (!v) this.input.clearTouch();
  }

  update(dt) {
    if (!this.visible) return;
    if (this.layout === 'tasten') {
      // Wie bei der Tastatur rampen, damit es fahrbar bleibt
      const want = this.steerKey;
      const rate = want === 0 ? 7.0 : 3.4;
      if (want === 0) {
        const back = rate * dt;
        this.steerValue = Math.abs(this.steerValue) <= back ? 0 : this.steerValue - Math.sign(this.steerValue) * back;
      } else {
        this.steerValue = Math.max(-1, Math.min(1, this.steerValue + want * rate * dt));
      }
      this.input.setTouchAxis('steer', this.steerValue);
    } else if (this.layout === 'schieber') {
      this.input.setTouchAxis('steer', this.steerValue);
    } else {
      this.input.setTouchAxis('steer', 0);
    }
  }
}
