/**
 * Bildschirmanzeige.
 *
 * Aufgebaut aus DOM-Elementen statt auf ein Canvas gezeichnet: Text bleibt so
 * auf jedem Geraet gestochen scharf, und pro Bild werden nur die Werte
 * geschrieben, die sich wirklich geaendert haben.
 */
import { formatTime } from '../track/timing.js';

function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

const REV_SEGMENTS = 22;

export class Hud {
  constructor(container, track) {
    this.track = track;
    this.root = el('div', 'hud', container);
    this._cache = {};

    // --- Rundenzeiten (oben links) ---------------------------------------
    const times = el('div', 'hud-panel hud-times', this.root);
    this.lapLabel = el('div', 'hud-lap-label', times, 'RUNDE 1');
    const cur = el('div', 'hud-time-row hud-current', times);
    el('span', 'hud-key', cur, 'AKTUELL');
    this.curTime = el('span', 'hud-val hud-big', cur, '0:00.000');
    const last = el('div', 'hud-time-row', times);
    el('span', 'hud-key', last, 'LETZTE');
    this.lastTime = el('span', 'hud-val', last, '--:--.---');
    const best = el('div', 'hud-time-row', times);
    el('span', 'hud-key', best, 'BESTE');
    this.bestTime = el('span', 'hud-val hud-purple', best, '--:--.---');
    this.deltaRow = el('div', 'hud-delta', times, '');

    this.sectorRow = el('div', 'hud-sectors', times);
    this.sectors = [0, 1, 2].map(() => el('div', 'hud-sector', this.sectorRow));

    // --- Tacho (oben rechts) ---------------------------------------------
    const dash = el('div', 'hud-panel hud-dash', this.root);
    this.revBar = el('div', 'hud-revbar', dash);
    this.revSegments = [];
    for (let i = 0; i < REV_SEGMENTS; i++) {
      const seg = el('div', 'hud-rev-seg', this.revBar);
      const t = i / (REV_SEGMENTS - 1);
      seg.dataset.zone = t < 0.62 ? 'green' : t < 0.84 ? 'yellow' : 'red';
      this.revSegments.push(seg);
    }
    const readout = el('div', 'hud-readout', dash);
    const speedBox = el('div', 'hud-speedbox', readout);
    this.speed = el('div', 'hud-speed', speedBox, '0');
    el('div', 'hud-unit', speedBox, 'km/h');
    this.gear = el('div', 'hud-gear', readout, 'N');

    const meta = el('div', 'hud-meta', dash);
    this.rpmText = el('span', 'hud-rpm', meta, '0 U/min');
    this.assistBox = el('span', 'hud-assists', meta);
    this.absLamp = el('span', 'hud-lamp', this.assistBox, 'ABS');
    this.tcLamp = el('span', 'hud-lamp', this.assistBox, 'TC');
    this.escLamp = el('span', 'hud-lamp', this.assistBox, 'ESP');

    // --- Eingabebalken ----------------------------------------------------
    const bars = el('div', 'hud-inputs', dash);
    this.throttleBar = el('div', 'hud-bar hud-bar-throttle', el('div', 'hud-bar-wrap', bars));
    this.brakeBar = el('div', 'hud-bar hud-bar-brake', el('div', 'hud-bar-wrap', bars));
    this.steerWrap = el('div', 'hud-steer', bars);
    this.steerDot = el('div', 'hud-steer-dot', this.steerWrap);

    // --- Reifen -----------------------------------------------------------
    // Temperatur und Restprofil je Rad. Im Simulator ist das keine Zierde:
    // kalte und ueberhitzte Reifen kosten spuerbar Grip.
    this.tyrePanel = el('div', 'hud-panel hud-tyres', this.root);
    el('div', 'hud-panel-title', this.tyrePanel, 'REIFEN');
    this.tyreGrid = el('div', 'hud-tyre-grid', this.tyrePanel);
    this.tyreCells = [];
    for (let i = 0; i < 4; i++) {
      const cell = el('div', 'hud-tyre', this.tyreGrid);
      const temp = el('div', 'hud-tyre-temp', cell, '--');
      const wearBar = el('div', 'hud-tyre-wear', cell);
      const wearFill = el('div', 'hud-tyre-wear-fill', wearBar);
      this.tyreCells.push({ cell, temp, wearFill });
    }

    // --- Tank -------------------------------------------------------------
    const fuelRow = el('div', 'hud-fuelrow', this.tyrePanel);
    el('span', 'hud-force-label', fuelRow, 'TANK');
    this.fuelText = el('span', 'hud-fuel-value', fuelRow, '--');

    // --- Lenkkraft --------------------------------------------------------
    const forceBar = el('div', 'hud-forcebar', this.tyrePanel);
    el('span', 'hud-force-label', forceBar, 'LENKKRAFT');
    const forceTrack = el('div', 'hud-force-track', forceBar);
    this.forceFill = el('div', 'hud-force-fill', forceTrack);

    // --- Karte ------------------------------------------------------------
    this.mapCanvas = el('canvas', 'hud-map', this.root);
    this.mapCanvas.width = 240;
    this.mapCanvas.height = 240;
    this.mapCtx = this.mapCanvas.getContext('2d');
    this._prepareMap();

    // --- Meldungen --------------------------------------------------------
    this.message = el('div', 'hud-message', this.root);
    this.messageTimer = 0;

    // --- Rundenliste ------------------------------------------------------
    this.lapList = el('div', 'hud-laplist', this.root);
  }

  _prepareMap() {
    const pts = this.track.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 16;
    const w = this.mapCanvas.width, h = this.mapCanvas.height;
    const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;
    // Bildschirm-Y laeuft nach unten, Welt-Z nach oben -> spiegeln
    this._map = { scale, ox, oz, h };
    this._mapPath = new Path2D();
    pts.forEach((p, i) => {
      const x = p.x * scale + ox;
      const y = h - (p.z * scale + oz);
      if (i === 0) this._mapPath.moveTo(x, y);
      else this._mapPath.lineTo(x, y);
    });
    this._mapPath.closePath();
  }

  _mapPoint(x, z) {
    const m = this._map;
    return { x: x * m.scale + m.ox, y: m.h - (z * m.scale + m.oz) };
  }

  _set(node, key, value) {
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    node.textContent = value;
  }

  showMessage(text, seconds = 2.2, kind = '') {
    this.message.textContent = text;
    this.message.className = 'hud-message hud-message-show ' + kind;
    this.messageTimer = seconds;
  }

  addLap(entry, best) {
    const row = el('div', 'hud-lap-entry' + (entry.best ? ' hud-lap-best' : '') + (entry.valid ? '' : ' hud-lap-invalid'), null);
    row.innerHTML = `<span>${entry.number}</span><span>${formatTime(entry.time)}</span>`;
    this.lapList.prepend(row);
    while (this.lapList.children.length > 6) this.lapList.lastChild.remove();
  }

  /**
   * @param {object} tel  Telemetrie
   * @param {object} timer LapTimer
   * @param {object} carPos {x,z}
   * @param {number} dt
   */
  update(tel, timer, carPos, dt, extra = {}) {
    // Tacho
    this._set(this.speed, 'speed', String(Math.round(Math.abs(tel.speedKmh))));
    this._set(this.gear, 'gear', tel.gear);
    this._set(this.rpmText, 'rpm', `${Math.round(tel.rpm / 10) * 10} U/min`);

    const revFrac = Math.min(1, tel.rpm / 8600);
    const lit = Math.round(revFrac * REV_SEGMENTS);
    if (this._cache.lit !== lit) {
      this._cache.lit = lit;
      for (let i = 0; i < REV_SEGMENTS; i++) {
        this.revSegments[i].classList.toggle('on', i < lit);
      }
    }
    const flash = tel.limiter > 0.2 || revFrac > 0.965;
    if (this._cache.flash !== flash) {
      this._cache.flash = flash;
      this.revBar.classList.toggle('shift', flash);
    }

    // Reifen: Temperatur einfaerben, Restprofil als Balken
    for (let i = 0; i < 4; i++) {
      const c = this.tyreCells[i];
      const t = Math.round(tel.tyreTemps[i]);
      if (this._cache['tt' + i] !== t) {
        this._cache['tt' + i] = t;
        c.temp.textContent = `${t}\u00b0`;
        // blau = kalt, gruen = im Fenster, rot = zu heiss
        const zone = t < 60 ? 'cold' : t < 105 ? 'good' : 'hot';
        if (c.cell.dataset.zone !== zone) c.cell.dataset.zone = zone;
      }
      const wear = Math.round((1 - tel.tyreWear[i]) * 100);
      if (this._cache['tw' + i] !== wear) {
        this._cache['tw' + i] = wear;
        c.wearFill.style.width = `${wear}%`;
      }
    }
    // Tank: Restmenge und Reichweite in Runden waeren ohne Rundenzeit raten
    const fuelKg = tel.fuel.toFixed(1);
    if (this._cache.fuel !== fuelKg) {
      this._cache.fuel = fuelKg;
      this.fuelText.textContent = `${fuelKg} kg`;
      this.fuelText.classList.toggle('low', tel.fuel < 5);
    }

    // Lenkkraft: Betrag des Rueckstellmoments am Lenkrad
    const steerForce = Math.min(1, Math.abs(tel.steeringTorque) / 18);
    this.forceFill.style.width = `${steerForce * 100}%`;

    // Lampen
    this.absLamp.classList.toggle('on', tel.abs);
    this.tcLamp.classList.toggle('on', tel.tc);
    this.escLamp.classList.toggle('on', tel.esc);

    // Eingaben
    this.throttleBar.style.height = `${tel.throttle * 100}%`;
    this.brakeBar.style.height = `${tel.brake * 100}%`;
    this.steerDot.style.left = `${50 + tel.steer * 46}%`;

    // Zeiten
    this._set(this.lapLabel, 'laplabel', `RUNDE ${timer.lapCount + 1}${timer.valid ? '' : ' - UNGUELTIG'}`);
    this.lapLabel.classList.toggle('invalid', !timer.valid);
    this._set(this.curTime, 'cur', timer.started ? formatTime(timer.lapTime) : '0:00.000');
    this._set(this.lastTime, 'last', formatTime(timer.lastLap));
    this._set(this.bestTime, 'best', formatTime(timer.bestLap));

    if (timer.delta !== null && timer.started) {
      const d = timer.delta;
      this._set(this.deltaRow, 'delta', formatTime(d, true));
      this.deltaRow.className = 'hud-delta ' + (d < 0 ? 'faster' : 'slower');
    } else {
      this._set(this.deltaRow, 'delta', '');
      this.deltaRow.className = 'hud-delta';
    }

    for (let i = 0; i < 3; i++) {
      const done = timer.currentSector > i || (timer.lastSectors[i] !== null && !timer.started);
      const t = timer.currentSector > i ? timer.sectorTimes[i] : null;
      const node = this.sectors[i];
      let cls = 'hud-sector';
      if (timer.currentSector === i && timer.started) cls += ' active';
      if (timer.currentSector > i) {
        const sectorTime = i === 0 ? timer.sectorTimes[0] : timer.sectorTimes[i] - timer.sectorTimes[i - 1];
        const bestS = timer.bestSectors[i];
        cls += bestS === null || sectorTime <= bestS ? ' good' : ' ok';
      }
      if (node.className !== cls) node.className = cls;
    }

    // Karte
    this._drawMap(carPos, extra.ghost);

    // Meldung ausblenden
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.className = 'hud-message';
    }
  }

  _drawMap(carPos, ghost) {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width, h = this.mapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.stroke(this._mapPath);
    ctx.strokeStyle = 'rgba(180,200,220,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke(this._mapPath);

    // Start/Ziel
    const sp = this.track.points[this.track.startIndex];
    const s = this._mapPoint(sp.x, sp.z);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(s.x - 3, s.y - 3, 6, 6);

    const c = this._mapPoint(carPos.x, carPos.z);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5a3c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }
}
