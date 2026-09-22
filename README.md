# Sim Racing

Ein Sim-Racing-Spiel im Browser. Laeuft am PC und auf dem Handy, ohne
Installation und ohne Download waehrend des Spiels.

## Starten

```bash
npm start
```

Dann `http://localhost:8080` im Browser oeffnen. Vom Handy aus geht es im
gleichen WLAN ueber die IP des Rechners, also z. B.
`http://192.168.1.23:8080`.

Ein Server ist noetig, weil das Spiel aus ES-Modulen besteht - die laedt kein
Browser ueber `file://`.

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

## Fahrhilfen

Alle einzeln abschaltbar. ABS, Traktionskontrolle und Automatikgetriebe sind
anfangs an, das Stabilitaetsprogramm ist aus. Wer es schwerer mag, schaltet
Traktionskontrolle und Lenkhilfe ab und stellt auf Handschaltung.

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

- **Reifen**: vereinfachte Pacejka-Formel, auf das Kraftmaximum normiert.
  Laengs- und Querkraft teilen sich denselben Reibkreis, wer also am Limit
  lenkt, hat weniger Grip zum Beschleunigen. Der Reibbeiwert sinkt mit
  steigender Radlast - deshalb veraendert Gewichtsverlagerung die Balance.
- **Vier Raeder einzeln**: jedes mit eigener Radlast, eigenem Schlupf und
  eigener Drehzahl. Gewichtsverlagerung baut sich mit einer Zeitkonstante
  auf, nicht sofort; daraus entstehen Lastwechselreaktionen.
- **Aerodynamik**: Abtrieb und Luftwiderstand steigen quadratisch mit dem
  Tempo. In schnellen Kurven klebt das Auto deutlich besser als in langsamen.
- **Antriebsstrang**: Drehmomentkurve, sequenzielles Sechsganggetriebe,
  Sperrdifferential und eine schlupfgeregelte Anfahrkupplung.
- **Fahrwerk**: gefederter, gedaempfter Aufbau mit Federweg. Ueber Kuppen
  wird das Auto leicht, bei genug Tempo hebt es ab.

Gemessene Eckwerte: 0-100 km/h in 4,2 s, 0-200 in 10,9 s, Hoechst-
geschwindigkeit 270 km/h, Bremsweg 100-0 rund 24 m, Querbeschleunigung
1,3 bis 1,7 g je nach Tempo.

## Werkzeuge

```bash
npm test          # Autopilot faehrt drei Runden und prueft die Zeitnahme
npm run strecke   # Streckenlayout pruefen und als PNG zeichnen
```

Der Autopilot ist der Regressionstest: er faehrt die Strecke ohne Grafik ab
und meldet Rundenzeiten, Sektoren, Bandenkontakte und wie lange er neben der
Strecke war.

## Aufbau

```
index.html            Einstiegspunkt mit Importmap
src/physics/          tyre.js, drivetrain.js, vehicle.js
src/track/            geometry.js, trackData.js, track.js, timing.js
src/render/           scene.js, cameras.js, trackMesh.js, scenery.js,
                      carModel.js, textures.js, effects.js
src/input/            input.js (Tastatur, Touch, Lenkrad, Neigung)
src/ui/               hud.js, touchControls.js, menu.js
src/audio/            engineAudio.js (synthetisiert, keine Audiodateien)
src/main.js           Spielschleife
vendor/three/         three.js r186, mitgeliefert
tools/                serve.mjs, autopilot.mjs, preview-track.mjs, png.mjs
```

Alle Texturen werden beim Start auf ein Canvas gezeichnet, der Motorklang
wird aus Oszillatoren synthetisiert. Das Spiel laedt also keine einzige
Mediendatei nach.
