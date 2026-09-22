# Sim Racing

Ein Sim-Racing-Spiel im Browser. Laeuft am PC und auf dem Handy, ohne
Installation und ohne Download waehrend des Spiels.

## Spielen

Drei Wege, je nachdem wo:

**Eine Datei, kein Server** - `sim-racing.html` herunterladen und
doppelklicken. Darin steckt alles: Spiel, Stylesheet und three.js. Kein
Server, keine Internetverbindung, nichts zu installieren. Die Datei laesst
sich verschicken oder auf einen Stick kopieren.

**Im Netz** - ueber GitHub Pages erreichbar unter einer normalen Adresse.
Das ist der bequemste Weg fuer das Handy, und nur dort funktioniert die
Neigungssteuerung zuverlaessig (die braucht eine per https ausgelieferte
Seite). Einschalten in den Repository-Einstellungen unter *Settings >
Pages*: als Quelle *Deploy from a branch* waehlen, den Branch mit dem
Spielstand und den Ordner `/ (root)`.

**Aus dem Quelltext** - fuer die Entwicklung:

```bash
npm start
```

Dann `http://localhost:8080` oeffnen. Vom Handy aus im gleichen WLAN ueber
die IP des Rechners, also z. B. `http://192.168.1.23:8080`.

Dieser Weg braucht einen Server, weil das Spiel aus ES-Modulen besteht - die
laedt kein Browser ueber `file://`. Die Einzeldatei umgeht das, indem der
gesamte Code zu einem klassischen Skript gebuendelt und direkt in die Seite
geschrieben wird; dann gibt es nichts mehr nachzuladen.

Neu bauen nach Aenderungen am Quelltext:

```bash
npm install   # einmalig, holt esbuild
npm run build # erzeugt sim-racing.html neu
```

## Steuerung

**Tastatur**

| Taste | Funktion |
| --- | --- |
| W / Pfeil hoch | Gas |
| S / Pfeil runter | Bremse (im Stand gehalten: Rueckwaertsgang) |
| A D / Pfeile links rechts | Lenken |
| Leertaste | Handbremse |
| E / Q | Hoch- und Runterschalten (bei Handschaltung) |
| C | Kamera wechseln |
| R | Zurueck auf die Strecke |
| T | Zurueck an den Start |
| Esc | Pause und Einstellungen |

**Handy** - drei Belegungen, umstellbar im Menue:

- *Tasten*: Pfeile links, Pedale rechts
- *Lenkstreifen*: waagerechter Schieber links, Pedale rechts
- *Neigung*: Lenken ueber die Neigung des Geraets. Einmal "Nullpunkt setzen"
  antippen, wenn das Handy so liegt, wie man es halten moechte.
  Auf iPhones fragt das Geraet beim Einschalten nach Erlaubnis.

Wie weit oben man das Gas- oder Bremspedal antippt, bestimmt, wie stark es
wirkt - damit laesst sich auch mit dem Daumen dosieren.

**Lenkrad und Gamepad** werden automatisch erkannt. Passt die Belegung nicht,
im Menue "Lenkrad kalibrieren" antippen und nacheinander Lenkrad, Gas und
Bremse bewegen; die Achse mit dem groessten Ausschlag wird uebernommen.

## Fahrstufen

| Stufe | ABS | Traktionskontrolle | Stabilitaetsprogramm | Getriebe | Lenkhilfe |
| --- | --- | --- | --- | --- | --- |
| GT3 realistisch | an | an | aus | Hand | aus |
| Profi | aus | aus | aus | Hand | aus |
| Einsteiger | an | an | an | Automatik | an |

Vorgabe ist **GT3 realistisch**, und zwar nicht als Kompromiss: echte
GT3-Fahrzeuge haben ABS und Traktionskontrolle, kein Stabilitaetsprogramm,
und geschaltet wird am Wippenschalter. Die Lenkhilfe ist keine Regelung im
Auto, sondern nur eine Eingabehilfe fuer Tastatur und Touch - sie
verkleinert dort den nutzbaren Lenkbereich bei hohem Tempo. Am Lenkrad
braucht man sie nicht.

## Abstimmung

Vierzehn Einstellgroessen, alle mit gemessener Wirkung am Grenzbereich:

| Gruppe | Einstellung |
| --- | --- |
| Bremsen | Bremsbalance, Bremskraft |
| Fahrwerk | Stabilisator vorne/hinten, Federrate vorne/hinten, Daempfung vorne/hinten |
| Aerodynamik | Heckfluegel, Frontabtrieb |
| Antrieb | Sperrwert Zug, Sperrwert Schub, Achsuebersetzung |
| Rennen | Tankinhalt |

Gemessene Beispiele (`npm run setup`):

- Stabilisatoren 80/8 auf 8/70 kN/m: von deutlich untersteuernd auf
  neutral, und die Querbeschleunigung steigt dabei von 1,54 auf 1,61 g -
  ein ausbalanciertes Auto ist schneller.
- Heckfluegel Stufe 1 auf 12 bei 230 km/h: 1,65 auf 1,86 g, dafuer rund
  15 km/h weniger Hoechstgeschwindigkeit.
- Frontabtrieb 34 auf 52 %: verschiebt die Balance bei hohem Tempo sichtbar
  von Unter- Richtung Uebersteuern.

Eine geaenderte Abstimmung baut das Auto neu auf und stellt es zurueck an
die Box - wie am Rennwochenende wird nicht waehrend der Fahrt geschraubt.

## Strecke

**Autodrom Nordwind**, 3309 m, 11 Kurven von 26 m (Haarnadel) bis 195 m
(Suedschleife) Radius, 21 m Hoehenunterschied. Richtwert fuer eine saubere
Runde: rund 1:20.

Runden zaehlen nur, wenn man auf der Strecke bleibt. Wer laenger als gut
anderthalb Sekunden mit allen vier Raedern daneben faehrt, bekommt die Runde
gestrichen.

## Wie das Fahrverhalten entsteht

Die Physik rechnet mit fester Schrittweite (240 Hz, auf schwacher Hardware
automatisch groeber) und ist unabhaengig von der Bildrate.

**Reifen.** Vereinfachte Pacejka-Formel, auf das Kraftmaximum normiert.
Laengs- und Querkraft teilen sich denselben Reibkreis: wer am Limit lenkt,
hat weniger Grip zum Beschleunigen. Der Reibbeiwert sinkt mit steigender
Radlast - deshalb veraendert Gewichtsverlagerung die Balance.

**Reifentemperatur und Verschleiss.** Jeder Reifen hat seinen eigenen
Waermehaushalt aus Reibleistung im Latsch und Walkarbeit und kuehlt am
Fahrtwind ab. Grip gibt es nur in einem Fenster um die Betriebstemperatur.
Gemessen, Bremsweg 100-0 km/h: bei 22 Grad 33,5 m, bei 80 Grad 24,1 m, bei
130 Grad 31,6 m. Ohne Heizdecken ist die erste Runde eine Aufwaermrunde.

**Fahrwerk.** An jeder Ecke traegt eine Feder mit Daempfer den Aufbau. Der
hat drei Freiheitsgrade - Hub, Nicken, Waelzen - und eigene Traegheiten,
und die Radlasten sind schlicht das, was die Federn gerade tragen.
Gewichtsverlagerung, Nicken beim Bremsen, Lastwechselreaktion,
Curbschlaege und abhebende Raeder ergeben sich daraus von selbst, mit den
Zeitkonstanten aus Federrate und Daempfung statt aus einer gewaehlten Zahl.
Der ueber Rollzentren und Anti-Dive-Geometrie laufende Anteil wirkt ohne
Verzoegerung. Nachgerechnet trifft die Lastverlagerung die Momentenbilanz
auf 0,2 Prozent.

**Lenkgefuehl.** Der Nachlauf der Aufstandsflaeche faellt zusammen, sobald
der Reifen ins Gleiten geht. Das Rueckstellmoment erreicht sein Maximum bei
rund 4 Grad Schraeglauf, die Querkraft erst bei 8 Grad - das Lenkrad wird
also leicht, BEVOR die Vorderachse wegrutscht. Die Anzeige Lenkkraft im HUD
zeigt genau dieses Signal.

**Aerodynamik.** Abtrieb und Luftwiderstand steigen quadratisch mit dem
Tempo. Der Abtrieb greift am Aufbau an und drueckt ihn auf die Federn, das
Auto liegt bei hohem Tempo also tiefer.

**Antriebsstrang.** Drehmomentkurve, sequenzielles Sechsganggetriebe,
Sperrdifferential mit getrennten Werten fuer Zug und Schub, schlupfgeregelte
Anfahrkupplung. Sprit wird aus der geleisteten Arbeit verbraucht (rund
0,29 kg/km), das Auto wird dabei leichter.

Gemessene Eckwerte mit warmen Reifen: 0-100 km/h in 4,2 s, 0-200 in 10,9 s,
Hoechstgeschwindigkeit 271 km/h, Bremsweg 100-0 rund 24 m,
Querbeschleunigung 1,45 g bei 80 km/h steigend auf 1,81 g bei 200 km/h.

## Werkzeuge

```bash
npm test          # Autopilot faehrt drei Runden und prueft die Zeitnahme
npm run strecke   # Streckenlayout pruefen und als PNG zeichnen
npm run build     # alles in die Einzeldatei sim-racing.html buendeln
npm run setup     # misst die Wirkung der Abstimmung am Grenzbereich
```

Der Autopilot ist der Regressionstest: er faehrt die Strecke ohne Grafik ab
und meldet Rundenzeiten, Sektoren, Bandenkontakte und wie lange er neben der
Strecke war.

## Aufbau

```
index.html            Einstiegspunkt mit Importmap
src/physics/          tyre.js, suspension.js, drivetrain.js, vehicle.js,
                      setup.js
src/track/            geometry.js, trackData.js, track.js, timing.js
src/render/           scene.js, cameras.js, trackMesh.js, scenery.js,
                      carModel.js, textures.js, effects.js
src/input/            input.js (Tastatur, Touch, Lenkrad, Neigung)
src/ui/               hud.js, touchControls.js, menu.js
src/audio/            engineAudio.js (synthetisiert, keine Audiodateien)
src/main.js           Spielschleife
vendor/three/         three.js r186, mitgeliefert
tools/                serve.mjs, autopilot.mjs, preview-track.mjs,
                      png.mjs, build-single.mjs, setup-test.mjs
sim-racing.html       eigenstaendige Fassung, erzeugt mit npm run build
```

Alle Texturen werden beim Start auf ein Canvas gezeichnet, der Motorklang
wird aus Oszillatoren synthetisiert. Das Spiel laedt also keine einzige
Mediendatei nach.
