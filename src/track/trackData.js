/**
 * Streckenlayout.
 *
 * Jede Ecke ist ein Wegpunkt mit Kurvenradius, Hoehe und Streckenbreite.
 * Der Kurs wird daraus mit tangentialen Kreisboegen aufgebaut, laeuft also
 * zwangslaeufig geschlossen. Fahrtrichtung: von Start/Ziel nach +Z.
 */

export const AUTODROM_NORDWIND = {
  id: 'nordwind',
  name: 'Autodrom Nordwind',
  country: 'Fiktiv',
  defaultWidth: 13,
  // Start/Ziel liegt auf der langen Geraden zwischen der letzten und der
  // ersten Ecke, gemessen als Bogenlaenge ab Streckenanfang.
  startOffset: 120,
  gridSpacing: 9,
  sectors: [0.34, 0.68],
  corners: [
    { name: 'Nordkehre',      x:    0, z:  470, radius:  46, elevation:   6, width: 13 },
    { name: 'Wasserturm',     x:  320, z:  660, radius: 155, elevation:   4, width: 14 },
    { name: 'Ostbogen',       x:  640, z:  520, radius: 115, elevation:   0, width: 13 },
    { name: 'Senke',          x:  700, z:  230, radius:  70, elevation:  -9, width: 13 },
    { name: 'Schikane links', x:  540, z:   50, radius:  34, elevation:  -6, width: 12 },
    { name: 'Schikane rechts',x:  660, z: -140, radius:  34, elevation:  -3, width: 12 },
    { name: 'Suedschleife',   x:  580, z: -420, radius: 195, elevation:   2, width: 14 },
    { name: 'Haarnadel',      x:  250, z: -520, radius:  26, elevation:   5, width: 15 },
    { name: 'Bergauf',        x:  140, z: -300, radius:  95, elevation:  10, width: 13 },
    { name: 'Kuppe',          x: -110, z: -260, radius:  85, elevation:  12, width: 13 },
    { name: 'Anfahrt Start',  x: -185, z:  -30, radius: 140, elevation:   8, width: 13 },
  ],
};

export const TRACKS = [AUTODROM_NORDWIND];
