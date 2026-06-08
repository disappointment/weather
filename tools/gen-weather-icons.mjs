// Regenerates the third-party weather icon-set <symbol>s in index.html.
//
//   node tools/gen-weather-icons.mjs
//
// Fetches each set's source SVGs from their CDN, normalizes them into sprite
// symbols (id="icon-<set>-<condition>"), namespaces Meteocons' internal gradient
// ids to avoid collisions, and injects the result between the existing
// <!-- ICON-SETS-INJECT --> marker in index.html. Idempotent: re-running
// replaces the previously injected block. The hand-authored Illustrated and
// Mono sets are not touched. See SVG_SETS in app.js for how they're rendered.
import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';

const COND = ['sun', 'moon', 'partly-day', 'partly-night', 'cloud', 'rain', 'snow', 'fog', 'thunder'];

// condition -> source filename, per set
const MAP = {
  lucide: { base: 'https://cdn.jsdelivr.net/npm/lucide-static/icons/', ext: '.svg', names: {
    sun: 'sun', moon: 'moon', 'partly-day': 'cloud-sun', 'partly-night': 'cloud-moon',
    cloud: 'cloud', rain: 'cloud-rain', snow: 'cloud-snow', fog: 'cloud-fog', thunder: 'cloud-lightning' } },
  phosphor: { base: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core/assets/regular/', ext: '.svg', names: {
    sun: 'sun', moon: 'moon', 'partly-day': 'cloud-sun', 'partly-night': 'cloud-moon',
    cloud: 'cloud', rain: 'cloud-rain', snow: 'cloud-snow', fog: 'cloud-fog', thunder: 'cloud-lightning' } },
  tabler: { base: 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/outline/', ext: '.svg', names: {
    sun: 'sun', moon: 'moon', 'partly-day': 'cloud', 'partly-night': 'cloud',
    cloud: 'cloud', rain: 'cloud-rain', snow: 'cloud-snow', fog: 'cloud-fog', thunder: 'cloud-storm' } },
  wi: { base: 'https://cdn.jsdelivr.net/gh/erikflowers/weather-icons@master/svg/', ext: '.svg', names: {
    sun: 'wi-day-sunny', moon: 'wi-night-clear', 'partly-day': 'wi-day-cloudy', 'partly-night': 'wi-night-alt-cloudy',
    cloud: 'wi-cloudy', rain: 'wi-rain', snow: 'wi-snow', fog: 'wi-fog', thunder: 'wi-thunderstorm' } },
  meteo: { base: 'https://cdn.jsdelivr.net/gh/basmilius/weather-icons@v2.0.0/production/fill/all/', ext: '.svg', names: {
    sun: 'clear-day', moon: 'clear-night', 'partly-day': 'partly-cloudy-day', 'partly-night': 'partly-cloudy-night',
    cloud: 'cloudy', rain: 'rain', snow: 'snow', fog: 'fog', thunder: 'thunderstorms' } },
};

// Tabler has no day/night cloud combo, so partly-day/night fall back to plain cloud.
const PRES = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray'];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'icon-gen' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} ${url}`)); }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parse(svg) {
  const open = svg.match(/<svg\b([^>]*)>/i);
  const vb = (open[1].match(/viewBox\s*=\s*"([^"]*)"/i) || [])[1] || '0 0 24 24';
  const pres = [];
  for (const p of PRES) {
    const m = open[1].match(new RegExp(`(?:^|\\s)${p}\\s*=\\s*"([^"]*)"`, 'i'));
    if (m) pres.push(`${p}="${m[1]}"`);
  }
  let inner = svg.slice(svg.indexOf('>', open.index) + 1);
  inner = inner.slice(0, inner.lastIndexOf('</svg>'));
  return { vb, pres: pres.join(' '), inner: inner.trim() };
}

// Namespace every internal id (defs gradients/clips) so symbols don't collide in one document.
function namespace(inner, prefix) {
  return inner
    .replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/(\bxlink:href|\bhref)="#([^"]+)"/g, (_, attr, id) => `${attr}="#${prefix}${id}"`);
}

const symbols = [];
const viewboxes = {};
for (const [set, cfg] of Object.entries(MAP)) {
  for (const c of COND) {
    const url = cfg.base + cfg.names[c] + cfg.ext;
    const raw = await get(url);
    const { vb, pres, inner: rawInner } = parse(raw);
    const inner = set === 'meteo' ? namespace(rawInner, `m-${c}-`) : rawInner;
    // Erik Flowers' SVGs ship without a fill, so force currentColor to theme them.
    const force = set === 'wi' && !/fill="/.test(pres) ? 'fill="currentColor"' : '';
    const attrs = [`id="icon-${set}-${c}"`, `viewBox="${vb}"`, force, pres].filter(Boolean).join(' ');
    symbols.push(`      <symbol ${attrs}>${inner}</symbol>`);
    if (!viewboxes[set]) viewboxes[set] = vb;
    if (viewboxes[set] !== vb) viewboxes[set] = 'MIXED:' + viewboxes[set] + '|' + vb;
  }
  console.error(`fetched ${set}`);
}

const frag = `<!-- Added icon sets: Lucide (ISC), Phosphor (MIT), Tabler (MIT), Weather Icons by Erik Flowers (OFL-1.1), Meteocons by Bas Milius (MIT) -->\n${symbols.join('\n')}\n      <!-- ICON-SETS-INJECT -->`;

const htmlPath = new URL('../index.html', import.meta.url);
let html = readFileSync(htmlPath, 'utf8');
// Idempotent: strip any previously injected block back to the bare marker first.
html = html.replace(/\n? *<!-- Added icon sets:[\s\S]*?<!-- ICON-SETS-INJECT -->/, '<!-- ICON-SETS-INJECT -->');
if (!html.includes('<!-- ICON-SETS-INJECT -->')) throw new Error('inject marker missing');
html = html.replace('<!-- ICON-SETS-INJECT -->', frag);
writeFileSync(htmlPath, html);

console.error('viewboxes: ' + JSON.stringify(viewboxes, null, 2));
console.error('injected ' + symbols.length + ' symbols');
