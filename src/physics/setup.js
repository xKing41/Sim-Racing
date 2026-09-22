/**
 * Fahrzeugabstimmung.
 *
 * Alles, was man in der Box verstellen wuerde, steht hier an einer Stelle:
 * Beschreibung fuer das Menue und Umrechnung in die Physik. Dadurch bleibt
 * beides zwangslaeufig synchron, und eine neue Einstellgroesse braucht nur
 * einen Eintrag.
 *
 * Die Bereiche sind so gewaehlt, dass jede Einstellung spuerbar ist, aber
 * keine das Auto unfahrbar macht.
 */

import { TYRE_COMPOUNDS } from './tyre.js';

/**
 * @typedef {{key:string, name:string, hint:string, min:number, max:number,
 *            step:number, unit:string, decimals?:number, group:string}} SetupField
 */

export const SETUP_FIELDS = [
  {
    key: 'brakeBias', name: 'Bremsbalance', group: 'Bremsen',
    hint: 'Anteil vorne. Mehr vorne bremst stabiler, mehr hinten dreht besser ein',
    min: 52, max: 72, step: 0.5, unit: '% vorne', decimals: 1,
  },
  {
    key: 'brakePower', name: 'Bremskraft', group: 'Bremsen',
    hint: 'Gesamtes Bremsmoment. Weniger erlaubt feineres Dosieren ohne ABS',
    min: 70, max: 110, step: 2, unit: '%',
  },
  {
    key: 'arbFront', name: 'Stabilisator vorne', group: 'Fahrwerk',
    hint: 'Haerter vorne = mehr Untersteuern. Das wichtigste Werkzeug fuer die Balance',
    min: 5, max: 85, step: 2, unit: 'kN/m',
  },
  {
    key: 'arbRear', name: 'Stabilisator hinten', group: 'Fahrwerk',
    hint: 'Haerter hinten = das Heck kommt frueher. Gegenstueck zur Vorderachse',
    min: 5, max: 85, step: 2, unit: 'kN/m',
  },
  {
    key: 'springFront', name: 'Federrate vorne', group: 'Fahrwerk',
    hint: 'Haerter reagiert direkter, schluckt aber Curbs schlechter',
    min: 100, max: 240, step: 5, unit: 'N/mm',
  },
  {
    key: 'springRear', name: 'Federrate hinten', group: 'Fahrwerk',
    hint: 'Haerter hinten bringt Traktion beim Herausbeschleunigen, macht aber nervoes',
    min: 90, max: 220, step: 5, unit: 'N/mm',
  },
  {
    key: 'damperFront', name: 'Daempfung vorne', group: 'Fahrwerk',
    hint: 'Hoeher beruhigt den Aufbau, niedriger laesst ihn arbeiten',
    min: 60, max: 150, step: 5, unit: '%',
  },
  {
    key: 'damperRear', name: 'Daempfung hinten', group: 'Fahrwerk',
    hint: 'Hoeher beruhigt das Heck beim Lastwechsel',
    min: 60, max: 150, step: 5, unit: '%',
  },
  {
    key: 'wing', name: 'Heckfluegel', group: 'Aerodynamik',
    hint: 'Mehr Fluegel klebt in schnellen Kurven, kostet aber Hoechstgeschwindigkeit',
    min: 1, max: 12, step: 1, unit: 'Stufe',
  },
  {
    key: 'aeroFront', name: 'Frontabtrieb', group: 'Aerodynamik',
    hint: 'Anteil des Abtriebs vorne. Mehr vorne dreht bei hohem Tempo williger ein',
    min: 34, max: 52, step: 1, unit: '%',
  },
  {
    key: 'diffPower', name: 'Sperrwert Zug', group: 'Antrieb',
    hint: 'Hoeher bringt Traktion am Kurvenausgang, schiebt aber ueber die Vorderachse',
    min: 10, max: 85, step: 5, unit: '%',
  },
  {
    key: 'diffCoast', name: 'Sperrwert Schub', group: 'Antrieb',
    hint: 'Hoeher beruhigt das Heck beim Anbremsen',
    min: 5, max: 70, step: 5, unit: '%',
  },
  {
    key: 'finalDrive', name: 'Achsuebersetzung', group: 'Antrieb',
    hint: 'Kuerzer beschleunigt besser, laenger bringt Hoechstgeschwindigkeit',
    min: 3.0, max: 4.2, step: 0.05, unit: ':1', decimals: 2,
  },
  {
    key: 'fuel', name: 'Tankinhalt', group: 'Rennen',
    hint: 'Sprit ist Gewicht. Voll getankt faehrt sich das Auto traeger',
    min: 10, max: 110, step: 5, unit: 'kg',
  },
];

export const DEFAULT_SETUP = {
  brakeBias: 63,
  brakePower: 100,
  arbFront: 32,
  arbRear: 30,
  springFront: 160,
  springRear: 140,
  damperFront: 100,
  damperRear: 100,
  wing: 6,
  aeroFront: 44,
  diffPower: 45,
  diffCoast: 25,
  finalDrive: 3.55,
  fuel: 60,
  compound: 'slick',
  tyrePreheat: true,
};

/** Fertige Abstimmungen als Ausgangspunkt. */
export const SETUP_PRESETS = {
  ausgewogen: {
    name: 'Ausgewogen',
    hint: 'Gutmuetig, gute Grundlage zum Weiterschrauben',
    values: {},
  },
  schnellkurs: {
    name: 'Schnellkurs',
    hint: 'Wenig Fluegel, lange Uebersetzung - fuer Strecken mit langen Geraden',
    values: { wing: 3, finalDrive: 3.3, springFront: 180, springRear: 160, arbFront: 48 },
  },
  lose: {
    name: 'Drehfreudig',
    hint: 'Weiche Vorderachse, viel Frontabtrieb - dreht ein, verzeiht aber wenig',
    values: { arbFront: 8, arbRear: 66, aeroFront: 50, springFront: 120, springRear: 190, diffCoast: 12 },
  },
  winklig: {
    name: 'Winklig',
    hint: 'Viel Fluegel, kurze Uebersetzung, dreht deutlich williger ein',
    values: { wing: 10, finalDrive: 3.9, arbFront: 22, arbRear: 40, aeroFront: 46, diffPower: 35 },
  },
  stabil: {
    name: 'Stabil',
    hint: 'Untersteuernd und gutmuetig - gut zum Streckelernen',
    values: { arbFront: 62, arbRear: 14, brakeBias: 67, diffCoast: 40, wing: 8, aeroFront: 38 },
  },
  qualifying: {
    name: 'Qualifying',
    hint: 'Leer getankt, alles auf eine schnelle Runde',
    values: { fuel: 15, wing: 7, springFront: 175, springRear: 155 },
  },
};

/** Grundwerte des Fahrzeugs ohne Abstimmung. */
const BASE_MASS = 1230; // kg ohne Sprit

/**
 * Rechnet eine Abstimmung in die Parameter von Fahrzeug, Fahrwerk und
 * Antrieb um.
 */
export function setupToPhysics(setup) {
  const s = { ...DEFAULT_SETUP, ...setup };

  // Mehr Fluegel heisst mehr Abtrieb, mehr Luftwiderstand und mehr Balance
  // nach hinten - alle drei haengen zusammen.
  const wing = s.wing;
  const liftArea = 2.55 + wing * 0.205;
  const dragArea = 1.09 + wing * 0.031;
  // Die Verteilung stellt der Frontsplitter ein, nicht der Fluegel
  const aeroBalance = s.aeroFront / 100;

  return {
    chassis: {
      mass: BASE_MASS + s.fuel,
      brakeBias: s.brakeBias / 100,
      brakeTorqueMax: 5400 * (s.brakePower / 100),
      liftArea,
      dragArea,
      aeroBalance,
    },
    suspension: {
      arbFront: s.arbFront * 1000,
      arbRear: s.arbRear * 1000,
      springRateFront: s.springFront * 1000,
      springRateRear: s.springRear * 1000,
      damperBumpFront: 5200 * (s.damperFront / 100),
      damperReboundFront: 8800 * (s.damperFront / 100),
      damperBumpRear: 4800 * (s.damperRear / 100),
      damperReboundRear: 8200 * (s.damperRear / 100),
    },
    drivetrain: {
      finalDrive: s.finalDrive,
      diffPowerLock: s.diffPower / 100,
      diffCoastLock: s.diffCoast / 100,
    },
    compound: TYRE_COMPOUNDS[s.compound] || TYRE_COMPOUNDS.slick,
    fuel: s.fuel,
    tyrePreheat: s.tyrePreheat,
  };
}

/**
 * Kurze Einschaetzung der Abstimmung fuer das Menue: geschaetzte Balance und
 * Hoechstgeschwindigkeit, damit man die Wirkung einer Aenderung sieht, ohne
 * erst eine Runde fahren zu muessen.
 */
export function describeSetup(setup) {
  const s = { ...DEFAULT_SETUP, ...setup };
  const trackF = 1.68;
  const trackR = 1.64;
  // Rollsteifigkeit je Achse aus Federn und Stabilisator
  const rollF = 2 * s.springFront * 1000 * (trackF / 2) ** 2 + s.arbFront * 1000 * trackF ** 2;
  const rollR = 2 * s.springRear * 1000 * (trackR / 2) ** 2 + s.arbRear * 1000 * trackR ** 2;
  const frontShare = rollF / (rollF + rollR);

  // Grobe Hoechstgeschwindigkeit aus Leistung gegen Luftwiderstand
  const dragArea = 1.09 + s.wing * 0.031;
  const power = 360000; // W an den Raedern, ueber den Rennbereich gemittelt
  const vmax = Math.cbrt((2 * power) / (1.225 * dragArea)) * 3.6;

  return {
    frontShare,
    // Die Schwellen stammen aus tools/setup-test.mjs: dort kippt das Auto
    // bei etwa 52 % Rollsteifigkeit vorne von Unter- in Uebersteuern.
    balance:
      frontShare > 0.62 ? 'deutlich untersteuernd'
      : frontShare > 0.555 ? 'leicht untersteuernd'
      : frontShare > 0.505 ? 'neutral'
      : frontShare > 0.455 ? 'leicht uebersteuernd'
      : 'deutlich uebersteuernd',
    vmax,
    mass: BASE_MASS + s.fuel,
  };
}

export { BASE_MASS };
