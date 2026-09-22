/**
 * Rundenzeiten, Sektoren und Vergleich zur besten Runde.
 *
 * Die Erkennung laeuft ueber den Streckenfortschritt, nicht ueber eine
 * Ziellinie im Raum: so zaehlt eine Runde nur, wenn man die Strecke auch
 * wirklich in Fahrtrichtung durchfahren hat, und Rueckwaertsfahren ueber die
 * Linie zaehlt nicht mit.
 */

export function formatTime(seconds, withSign = false) {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return '--:--.---';
  const sign = seconds < 0 ? '-' : withSign ? '+' : '';
  const t = Math.abs(seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (withSign) return `${sign}${s.toFixed(3)}`;
  return `${sign}${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const SAMPLE_COUNT = 400; // Stuetzstellen fuer den Zeitvergleich

export class LapTimer {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.lapTime = 0;
    this.lapCount = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.laps = [];
    this.sectorTimes = [null, null, null];
    this.bestSectors = [null, null, null];
    this.lastSectors = [null, null, null];
    this.currentSector = 0;
    this.started = false;
    this.valid = true;
    this.offTrackTime = 0;

    this._prevProgress = null;
    this._trace = new Float32Array(SAMPLE_COUNT).fill(NaN);
    this._bestTrace = null;
    this._nextSample = 0;
    this.delta = null;
  }

  /**
   * @param {number} dt
   * @param {number} s        Bogenlaenge des Autos auf der Strecke
   * @param {boolean} offTrack alle vier Raeder neben der Strecke
   * @param {number} speed
   */
  update(dt, s, offTrack, speed) {
    const p = this.track.progress(s);

    if (this._prevProgress === null) {
      this._prevProgress = p;
      return null;
    }

    let completed = null;
    const dp = p - this._prevProgress;

    // Sprung von fast 1 auf fast 0 = Ziellinie in Fahrtrichtung ueberfahren
    if (dp < -0.5) {
      if (this.started) {
        // Zeitpunkt der Linie zwischen den Bildern interpolieren
        const frac = (1 - this._prevProgress) / (1 - this._prevProgress + p || 1);
        const lap = this.lapTime + dt * frac;
        completed = this._completeLap(lap);
        this.lapTime = dt * (1 - frac);
      } else {
        this.started = true;
        this.lapTime = 0;
        this.valid = true;
        this.offTrackTime = 0;
        this.currentSector = 0;
        this.sectorTimes = [null, null, null];
        this._trace.fill(NaN);
        this._nextSample = 0;
      }
    } else if (dp > 0.5) {
      // rueckwaerts ueber die Linie: laufende Runde verwerfen
      this.valid = false;
    } else if (this.started) {
      this.lapTime += dt;
    }

    if (this.started) {
      // Sektoren
      const splits = this.track.def.sectors || [0.34, 0.68];
      if (this.currentSector === 0 && p >= splits[0] && p < splits[1]) {
        this.sectorTimes[0] = this.lapTime;
        this.currentSector = 1;
      } else if (this.currentSector === 1 && p >= splits[1]) {
        this.sectorTimes[1] = this.lapTime;
        this.currentSector = 2;
      }

      // Zeitverlauf fuer den Vergleich mitschreiben
      const slot = Math.min(SAMPLE_COUNT - 1, Math.floor(p * SAMPLE_COUNT));
      while (this._nextSample <= slot) {
        this._trace[this._nextSample] = this.lapTime;
        this._nextSample++;
      }

      // Runde ungueltig, wenn man deutlich abkuerzt oder lange daneben faehrt
      if (offTrack && speed > 8) {
        this.offTrackTime += dt;
        if (this.offTrackTime > 1.6) this.valid = false;
      } else if (!offTrack) {
        this.offTrackTime = Math.max(0, this.offTrackTime - dt * 0.7);
      }

      // Abstand zur besten Runde an derselben Stelle
      if (this._bestTrace && isFinite(this._bestTrace[slot])) {
        this.delta = this.lapTime - this._bestTrace[slot];
      } else {
        this.delta = null;
      }
    }

    this._prevProgress = p;
    return completed;
  }

  _completeLap(time) {
    this.sectorTimes[2] = time;
    const sectors = [
      this.sectorTimes[0],
      this.sectorTimes[1] !== null && this.sectorTimes[0] !== null ? this.sectorTimes[1] - this.sectorTimes[0] : null,
      this.sectorTimes[1] !== null ? time - this.sectorTimes[1] : null,
    ];

    const entry = { time, valid: this.valid, sectors, number: this.lapCount + 1 };
    this.laps.push(entry);
    this.lapCount++;
    this.lastLap = time;
    this.lastSectors = sectors;

    if (this.valid) {
      for (let i = 0; i < 3; i++) {
        if (sectors[i] !== null && (this.bestSectors[i] === null || sectors[i] < this.bestSectors[i])) {
          this.bestSectors[i] = sectors[i];
        }
      }
      if (this.bestLap === null || time < this.bestLap) {
        this.bestLap = time;
        this._bestTrace = Float32Array.from(this._trace);
        entry.best = true;
      }
    }

    // fuer die naechste Runde zuruecksetzen
    this.valid = true;
    this.offTrackTime = 0;
    this.currentSector = 0;
    this.sectorTimes = [null, null, null];
    this._trace.fill(NaN);
    this._nextSample = 0;
    return entry;
  }

  /** Nach einem Reset auf die Strecke: laufende Runde verwerfen. */
  invalidate() {
    this.valid = false;
  }

  /** Zeitmessung komplett neu beginnen (z. B. nach Zurueck an die Box). */
  restart() {
    this.started = false;
    this.lapTime = 0;
    this._prevProgress = null;
    this.valid = true;
    this.offTrackTime = 0;
    this.currentSector = 0;
    this.sectorTimes = [null, null, null];
    this._trace.fill(NaN);
    this._nextSample = 0;
    this.delta = null;
  }
}
