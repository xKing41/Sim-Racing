/**
 * Baut das ganze Spiel in EINE HTML-Datei.
 *
 * Hintergrund: das Spiel besteht aus ES-Modulen, und die laedt kein Browser
 * ueber file:// - er blockiert sie als Verstoss gegen die Gleiche-Herkunft-
 * Regel. Wird dagegen der gesamte Code zu einem klassischen Skript gebuendelt
 * und direkt in die Seite geschrieben, gibt es nichts mehr nachzuladen. Die
 * Datei laesst sich dann per Doppelklick oeffnen, verschicken oder auf einen
 * Stick kopieren.
 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'sim-racing.html');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  // IIFE statt ESM: klassische Skripte unterliegen ueber file:// keiner
  // Herkunftspruefung, Modulskripte schon.
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  alias: { three: path.join(root, 'vendor/three/three.module.js') },
  write: false,
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
const css = await fs.readFile(path.join(root, 'styles/main.css'), 'utf8');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;

// Skriptende im Quelltext darf die Seite nicht vorzeitig beenden
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0b0d12">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Sim Racing &middot; Autodrom Nordwind</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#127950;</text></svg>">
<!--
  Sim Racing ${version} - vollstaendig eigenstaendige Fassung.
  Enthaelt Spiel, Stylesheet und three.js. Braucht keinen Server und keine
  Internetverbindung. Erzeugt mit: npm run build
-->
<style>
${css}
</style>
</head>
<body>
  <canvas id="view"></canvas>
  <div id="ui"></div>
  <div id="boot">
    <div class="boot-inner">
      <div class="boot-title">SIM RACING</div>
      <div class="boot-bar"><span></span></div>
      <div class="boot-note">Strecke wird gebaut&hellip;</div>
    </div>
  </div>
<script>
${safeJs}
</script>
</body>
</html>
`;

await fs.writeFile(out, html, 'utf8');
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`sim-racing.html geschrieben - ${kb} KB, eine Datei, kein Server noetig.`);
