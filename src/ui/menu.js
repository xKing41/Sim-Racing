/**
 * Startbildschirm, Pausenmenue und Einstellungen.
 *
 * Einstellungen liegen im localStorage, damit Farbe, Fahrhilfen und
 * Steuerungsart beim naechsten Start wieder stimmen.
 */
import { TOUCH_LAYOUTS, TOUCH_LABELS } from './touchControls.js';
import { CAMERA_MODES, CAMERA_LABELS } from '../render/cameras.js';
import { formatTime } from '../track/timing.js';
import { ASSIST_PRESETS } from '../physics/vehicle.js';
import { SETUP_FIELDS, DEFAULT_SETUP, SETUP_PRESETS, describeSetup } from '../physics/setup.js';

const STORAGE_KEY = 'simracing.settings.v1';

export const CAR_COLORS = [
  { name: 'Rennblau', value: 0x1d4fd8 },
  { name: 'Signalrot', value: 0xcf2b22 },
  { name: 'Giftgruen', value: 0x4fbb3a },
  { name: 'Sonnengelb', value: 0xe8b619 },
  { name: 'Mattschwarz', value: 0x1a1c20 },
  { name: 'Perlweiss', value: 0xe8e8e4 },
  { name: 'Orange', value: 0xea6a1c },
  { name: 'Violett', value: 0x7b3fd4 },
];

export const DEFAULT_SETTINGS = {
  color: 0x1d4fd8,
  number: '41',
  quality: 'medium',
  camera: 'cockpit',
  touchLayout: 'tasten',
  tilt: false,
  tiltRange: 28,
  volume: 0.65,
  muted: false,
  // Vorgabe bildet ein echtes GT3 ab: ABS und Traktionskontrolle an,
  // von Hand geschaltet, keine Lenkhilfe.
  level: 'gt3',
  assists: { ...ASSIST_PRESETS.gt3.assists },
  setup: { ...DEFAULT_SETUP },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      assists: { ...DEFAULT_SETTINGS.assists, ...(parsed.assists || {}) },
      setup: { ...DEFAULT_SETUP, ...(parsed.setup || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* Speicher nicht verfuegbar - dann eben nur fuer diese Sitzung */
  }
}

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export class Menu {
  /**
   * @param {HTMLElement} container
   * @param {object} settings
   * @param {{onStart:Function, onChange:Function, onResume:Function,
   *          onRestart:Function, onCalibrateTilt:Function,
   *          onCalibrateWheel:Function, onEnableTilt:Function}} handlers
   */
  constructor(container, settings, handlers) {
    this.settings = settings;
    this.h = handlers;
    this.mode = 'start';

    this.root = el('div', 'menu', container);
    this.panel = el('div', 'menu-panel', this.root);

    this.header = el('div', 'menu-header', this.panel);
    this.title = el('h1', 'menu-title', this.header, 'SIM RACING');
    this.subtitle = el('div', 'menu-subtitle', this.header, 'Autodrom Nordwind · GT Coupe');

    this.body = el('div', 'menu-body', this.panel);
    this.footer = el('div', 'menu-footer', this.panel);

    this.primaryBtn = el('button', 'menu-btn menu-btn-primary', this.footer, 'FAHREN');
    this.primaryBtn.addEventListener('click', () => this._primary());
    this.secondaryBtn = el('button', 'menu-btn', this.footer, 'Neu starten');
    this.secondaryBtn.addEventListener('click', () => this.h.onRestart && this.h.onRestart());

    this._buildSections();
    this.setMode('start');
  }

  _primary() {
    if (this.mode === 'start') this.h.onStart && this.h.onStart();
    else this.h.onResume && this.h.onResume();
  }

  _change() {
    saveSettings(this.settings);
    this.h.onChange && this.h.onChange(this.settings);
  }

  _section(title) {
    const s = el('div', 'menu-section', this.body);
    el('div', 'menu-section-title', s, title);
    return el('div', 'menu-section-body', s);
  }

  _chips(parent, options, getValue, setValue) {
    const wrap = el('div', 'menu-chips', parent);
    const nodes = options.map((opt) => {
      const b = el('button', 'menu-chip', wrap, opt.label);
      b.addEventListener('click', () => {
        setValue(opt.value);
        this._change();
        refresh();
      });
      return { b, opt };
    });
    const refresh = () => {
      const v = getValue();
      for (const { b, opt } of nodes) b.classList.toggle('on', opt.value === v);
    };
    refresh();
    return refresh;
  }

  _toggle(parent, label, get, set, hint) {
    const row = el('label', 'menu-toggle', parent);
    const left = el('div', 'menu-toggle-text', row);
    el('div', 'menu-toggle-label', left, label);
    if (hint) el('div', 'menu-toggle-hint', left, hint);
    const box = el('input', 'menu-switch', row);
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => {
      set(box.checked);
      this._change();
    });
    return () => { box.checked = get(); };
  }

  _buildSections() {
    const s = this.settings;

    // --- Steuerung --------------------------------------------------------
    const ctrl = this._section('Steuerung');
    this.refreshTouch = this._chips(
      ctrl,
      TOUCH_LAYOUTS.map((l) => ({ label: TOUCH_LABELS[l], value: l })),
      () => (s.tilt ? 'neigung' : s.touchLayout),
      (v) => {
        if (v === 'neigung') {
          s.tilt = true;
          s.touchLayout = 'neigung';
          this.h.onEnableTilt && this.h.onEnableTilt();
        } else {
          s.tilt = false;
          s.touchLayout = v;
        }
      }
    );

    this.tiltRow = el('div', 'menu-row', ctrl);
    this.tiltStatus = el('div', 'menu-hint', this.tiltRow, '');
    this.tiltBtn = el('button', 'menu-btn menu-btn-small', this.tiltRow, 'Nullpunkt setzen');
    this.tiltBtn.addEventListener('click', () => this.h.onCalibrateTilt && this.h.onCalibrateTilt());

    const tiltSens = el('div', 'menu-slider-row', ctrl);
    el('span', 'menu-slider-label', tiltSens, 'Neigungsbereich');
    const tiltRange = el('input', 'menu-slider', tiltSens);
    tiltRange.type = 'range';
    tiltRange.min = '12';
    tiltRange.max = '45';
    tiltRange.value = String(s.tiltRange);
    const tiltVal = el('span', 'menu-slider-value', tiltSens, `${s.tiltRange}°`);
    tiltRange.addEventListener('input', () => {
      s.tiltRange = Number(tiltRange.value);
      tiltVal.textContent = `${s.tiltRange}°`;
      this._change();
    });

    this.wheelRow = el('div', 'menu-row', ctrl);
    this.wheelStatus = el('div', 'menu-hint', this.wheelRow, 'Kein Lenkrad erkannt');
    this.wheelBtn = el('button', 'menu-btn menu-btn-small', this.wheelRow, 'Lenkrad kalibrieren');
    this.wheelBtn.addEventListener('click', () => this.h.onCalibrateWheel && this.h.onCalibrateWheel());

    // --- Fahrstufe --------------------------------------------------------
    const aid = this._section('Fahrstufe');
    this.refreshLevel = this._chips(
      aid,
      Object.entries(ASSIST_PRESETS).map(([key, p]) => ({ label: p.name, value: key })),
      () => s.level,
      (v) => {
        s.level = v;
        Object.assign(s.assists, ASSIST_PRESETS[v].assists);
        for (const fn of this.refreshAssists || []) fn();
      }
    );
    this.levelHint = el('div', 'menu-hint', aid, ASSIST_PRESETS[s.level]?.hint || '');

    const markCustom = () => {
      s.level = 'eigene';
      this.levelHint.textContent = 'Eigene Zusammenstellung';
      this.refreshLevel();
    };
    this.refreshAssists = [
      this._toggle(aid, 'ABS', () => s.assists.abs, (v) => { s.assists.abs = v; markCustom(); },
        'Verhindert blockierende Raeder. Echte GT3-Autos haben es'),
      this._toggle(aid, 'Traktionskontrolle', () => s.assists.tractionControl, (v) => { s.assists.tractionControl = v; markCustom(); },
        'Begrenzt durchdrehende Hinterraeder. Echte GT3-Autos haben sie'),
      this._toggle(aid, 'Stabilitaetsprogramm', () => s.assists.stabilityControl, (v) => { s.assists.stabilityControl = v; markCustom(); },
        'Faengt Ausbrechen ab. Im Rennsport nicht zugelassen'),
      this._toggle(aid, 'Lenkhilfe', () => s.assists.steerAssist, (v) => { s.assists.steerAssist = v; markCustom(); },
        'Nur fuer Tastatur und Touch: kleinerer Lenkbereich bei hohem Tempo'),
      this._toggle(aid, 'Automatikgetriebe', () => s.assists.autoGearbox, (v) => { s.assists.autoGearbox = v; markCustom(); },
        'Aus: mit Q/E, den Wippen oder den Knoepfen schalten'),
    ];
    this._toggle(aid, 'Reifen vorgewaermt', () => s.setup.tyrePreheat, (v) => { s.setup.tyrePreheat = v; },
      'Aus: Start auf kalten Reifen, die erste Runde ist dann eine Aufwaermrunde');

    // --- Abstimmung -------------------------------------------------------
    this._buildSetupSection();

    // --- Auto -------------------------------------------------------------
    const car = this._section('Auto');
    const colorWrap = el('div', 'menu-colors', car);
    const colorNodes = CAR_COLORS.map((c) => {
      const b = el('button', 'menu-color', colorWrap);
      b.style.background = `#${c.value.toString(16).padStart(6, '0')}`;
      b.title = c.name;
      b.addEventListener('click', () => {
        s.color = c.value;
        this._change();
        refreshColors();
      });
      return { b, c };
    });
    const refreshColors = () => {
      for (const { b, c } of colorNodes) b.classList.toggle('on', c.value === s.color);
    };
    refreshColors();

    const numRow = el('div', 'menu-slider-row', car);
    el('span', 'menu-slider-label', numRow, 'Startnummer');
    const numInput = el('input', 'menu-number', numRow);
    numInput.type = 'text';
    numInput.maxLength = 3;
    numInput.value = s.number;
    numInput.addEventListener('change', () => {
      s.number = (numInput.value || '41').replace(/[^0-9]/g, '').slice(0, 3) || '41';
      numInput.value = s.number;
      this._change();
    });

    // --- Bild und Ton -----------------------------------------------------
    const av = this._section('Bild und Ton');
    this.refreshCamera = this._chips(
      av,
      CAMERA_MODES.map((m) => ({ label: CAMERA_LABELS[m], value: m })),
      () => s.camera,
      (v) => (s.camera = v)
    );
    this.refreshQuality = this._chips(
      av,
      [
        { label: 'Sparsam', value: 'low' },
        { label: 'Mittel', value: 'medium' },
        { label: 'Hoch', value: 'high' },
      ],
      () => s.quality,
      (v) => (s.quality = v)
    );
    const volRow = el('div', 'menu-slider-row', av);
    el('span', 'menu-slider-label', volRow, 'Lautstaerke');
    const vol = el('input', 'menu-slider', volRow);
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(s.volume * 100));
    const volVal = el('span', 'menu-slider-value', volRow, `${Math.round(s.volume * 100)}`);
    vol.addEventListener('input', () => {
      s.volume = Number(vol.value) / 100;
      s.muted = s.volume === 0;
      volVal.textContent = vol.value;
      this._change();
    });

    // --- Tastenbelegung ---------------------------------------------------
    const keys = this._section('Tastatur');
    const list = el('div', 'menu-keys', keys);
    const K = [
      ['W / Pfeil hoch', 'Gas'],
      ['S / Pfeil runter', 'Bremse'],
      ['A D / Pfeile', 'Lenken'],
      ['Leertaste', 'Handbremse'],
      ['E / Q', 'Hoch- / Runterschalten'],
      ['C', 'Kamera wechseln'],
      ['R', 'Zurueck auf die Strecke'],
      ['T', 'Zurueck an den Start'],
      ['Esc', 'Pause'],
    ];
    for (const [k, v] of K) {
      const row = el('div', 'menu-key-row', list);
      el('kbd', '', row, k);
      el('span', '', row, v);
    }

    // --- Ergebnisse -------------------------------------------------------
    this.resultsSection = el('div', 'menu-section', this.body);
    el('div', 'menu-section-title', this.resultsSection, 'Runden');
    this.resultsBody = el('div', 'menu-results', this.resultsSection);
    this.resultsSection.style.display = 'none';
  }

  /**
   * Abstimmung: Schieberegler aus dem Schema in src/physics/setup.js.
   * Dadurch taucht jede neue Einstellgroesse automatisch hier auf.
   */
  _buildSetupSection() {
    const s = this.settings;
    const body = this._section('Abstimmung');

    this.refreshSetupPreset = this._chips(
      body,
      Object.entries(SETUP_PRESETS).map(([key, p]) => ({ label: p.name, value: key })),
      () => s.setupPreset || 'ausgewogen',
      (v) => {
        s.setupPreset = v;
        Object.assign(s.setup, DEFAULT_SETUP, SETUP_PRESETS[v].values);
        for (const fn of this.refreshSetupFields) fn();
        this._updateSetupSummary();
      }
    );

    this.setupSummary = el('div', 'menu-setup-summary', body);

    this.refreshSetupFields = [];
    let currentGroup = null;
    let groupBody = body;
    for (const field of SETUP_FIELDS) {
      if (field.group !== currentGroup) {
        currentGroup = field.group;
        groupBody = el('div', 'menu-setup-group', body);
        el('div', 'menu-setup-group-title', groupBody, currentGroup);
      }
      this.refreshSetupFields.push(this._setupSlider(groupBody, field));
    }
    this._updateSetupSummary();
  }

  _setupSlider(parent, field) {
    const s = this.settings;
    const row = el('div', 'menu-setup-row', parent);
    const head = el('div', 'menu-setup-head', row);
    el('span', 'menu-setup-name', head, field.name);
    const value = el('span', 'menu-setup-value', head, '');
    const input = el('input', 'menu-slider', row);
    input.type = 'range';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    el('div', 'menu-setup-hint', row, field.hint);

    const show = () => {
      const v = s.setup[field.key];
      input.value = String(v);
      value.textContent = `${v.toFixed(field.decimals || 0)} ${field.unit}`;
    };
    input.addEventListener('input', () => {
      s.setup[field.key] = Number(input.value);
      s.setupPreset = 'eigene';
      this.refreshSetupPreset();
      show();
      this._updateSetupSummary();
      this._change();
    });
    show();
    return show;
  }

  _updateSetupSummary() {
    const d = describeSetup(this.settings.setup);
    this.setupSummary.innerHTML =
      `<span>Balance <b>${d.balance}</b></span>` +
      `<span>${(d.frontShare * 100).toFixed(0)}% Rollsteifigkeit vorne</span>` +
      `<span>~${d.vmax.toFixed(0)} km/h</span>` +
      `<span>${d.mass.toFixed(0)} kg</span>`;
  }

  /** Aktuellen Geraetestatus in die Steuerungs-Sektion schreiben. */
  updateDeviceStatus(input) {
    const preset = ASSIST_PRESETS[this.settings.level];
    const hint = preset ? preset.hint : 'Eigene Zusammenstellung';
    if (this.levelHint.textContent !== hint) this.levelHint.textContent = hint;

    const tilt = input.tilt;
    let text;
    if (!this.settings.tilt) text = 'Neigung ist aus';
    else if (tilt.permission === 'unsupported') text = 'Dieses Geraet meldet keine Neigung';
    else if (tilt.permission === 'denied') text = 'Zugriff auf die Neigung wurde abgelehnt';
    else if (!tilt.available) text = 'Warte auf Neigungsdaten – Geraet kurz bewegen';
    else text = `Neigung aktiv (${tilt.raw.toFixed(0)}°, Mitte ${tilt.center.toFixed(0)}°)`;
    if (this.tiltStatus.textContent !== text) this.tiltStatus.textContent = text;
    this.tiltBtn.disabled = !this.settings.tilt || !tilt.available;

    const wheel = input.gamepadIndex !== null ? input.gamepadName : null;
    const wt = input.calibration
      ? `Kalibrierung: ${{ steer: 'Lenkrad drehen', throttle: 'Gas geben', brake: 'Bremse treten' }[input.calibration.steps[input.calibration.index]] || ''}`
      : wheel
        ? `Erkannt: ${wheel.slice(0, 40)}`
        : 'Kein Lenkrad erkannt';
    if (this.wheelStatus.textContent !== wt) this.wheelStatus.textContent = wt;
    this.wheelBtn.disabled = input.gamepadIndex === null;
    this.wheelBtn.textContent = input.calibration ? 'Abbrechen' : 'Lenkrad kalibrieren';
  }

  showResults(timer) {
    if (!timer.laps.length) {
      this.resultsSection.style.display = 'none';
      return;
    }
    this.resultsSection.style.display = '';
    this.resultsBody.innerHTML = '';
    const head = el('div', 'menu-result-row menu-result-head', this.resultsBody);
    el('span', '', head, 'Runde');
    el('span', '', head, 'Zeit');
    el('span', '', head, 'S1');
    el('span', '', head, 'S2');
    el('span', '', head, 'S3');
    for (const lap of [...timer.laps].reverse().slice(0, 12)) {
      const row = el('div', 'menu-result-row' + (lap.best ? ' best' : '') + (lap.valid ? '' : ' invalid'), this.resultsBody);
      el('span', '', row, String(lap.number));
      el('span', '', row, formatTime(lap.time));
      for (let i = 0; i < 3; i++) {
        el('span', '', row, lap.sectors[i] !== null ? lap.sectors[i].toFixed(2) : '--');
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'start') {
      this.title.textContent = 'SIM RACING';
      this.primaryBtn.textContent = 'FAHREN';
      this.secondaryBtn.style.display = 'none';
    } else {
      this.title.textContent = 'PAUSE';
      this.primaryBtn.textContent = 'WEITERFAHREN';
      this.secondaryBtn.style.display = '';
    }
  }

  show(mode) {
    if (mode) this.setMode(mode);
    this.root.classList.add('open');
  }

  hide() {
    this.root.classList.remove('open');
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }
}
