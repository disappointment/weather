# Weather Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean, client-side weather forecast page (Open-Meteo, keyless) and deploy it to the otter k3s cluster via Flux + nginx-from-ConfigMap.

**Architecture:** Pure-logic functions live in `weather.js` (unit-tested with Node's built-in test runner, no build step). DOM/fetch/geolocation wiring lives in `app.js`. `index.html` + `styles.css` provide the "soft & atmospheric" UI with a condition-reactive background gradient. The three site files are baked into a Kubernetes ConfigMap by Kustomize `configMapGenerator` and served by `nginx:alpine`. Flux pulls this repo directly via a small `clusters/otter/weather.yaml` added to otter-flux.

**Tech Stack:** Vanilla HTML/CSS/ES-modules JavaScript; Node `node --test` for unit tests; Kustomize; Flux; nginx:alpine; k3s.

**Reference spec:** `docs/superpowers/specs/2026-06-04-weather-page-design.md`

---

## File Structure

```
weather/                         (own public GitHub repo)
  package.json                   {"type":"module"} + test script (no deps)
  .gitignore                     already present (.superpowers/)
  README.md                      run-locally + deploy notes
  index.html                     markup + inline SVG icon <defs>
  styles.css                     layout, frosted cards, theme gradients
  weather.js                     PURE logic (exported, browser-agnostic)
  app.js                         DOM wiring, fetch, geolocation, state
  test/weather.test.js           node --test unit tests for weather.js
  kustomization.yaml             ROOT (configMapGenerator + deploy resources)
  deploy/
    namespace.yaml
    deployment.yaml              nginx:alpine, mounts ConfigMap
    service.yaml                 NodePort 30095
  docs/superpowers/{specs,plans}/
```

`weather.js` exports (every later task depends on these exact names):
- `CODE_TABLE` — `{ [code]: [label, group] }`
- `describeWeather(code, isDay)` → `{ label, icon, theme }`
- `floorToHour(iso)` → `'YYYY-MM-DDTHH:00'`
- `sliceNext24(hourly, currentIso)` → `[{ time, temp, code, isDay, precip, uv, visibility }]`
- `degToCompass(deg)` → e.g. `'NE'`
- `metersToMiles(m)` → number (1 decimal)
- `rangeBar(min, max, weekMin, weekMax)` → `{ left, width }` (percent numbers)
- `forecastUrl(lat, lon, unit)` → string
- `geocodeUrl(query)` → string
- `reverseGeocodeUrl(lat, lon)` → string
- `parsePlaces(json)` → `[{ name, lat, lon }]`

---

## Task 1: Repo scaffolding

**Files:**
- Create: `package.json`, `README.md`
- Verify: `.gitignore` (already contains `.superpowers/`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "weather",
  "version": "1.0.0",
  "description": "Personal weather forecast page (Open-Meteo, client-side).",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Weather

A clean, client-side weather forecast page. Data from Open-Meteo (no API key).

## Run locally
Open `index.html` directly in a browser. No build step.

## Test the logic
`npm test`  (uses Node's built-in test runner; no dependencies)

## Deploy (otter cluster)
Files are served by nginx from a Kustomize-generated ConfigMap; Flux pulls this
repo directly.
1. Edit `index.html` / `styles.css` / `weather.js` / `app.js`
2. `git push` to `main`
3. Reconcile:
   `ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl annotate gitrepository/weather -n flux-system reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite'`

Served at http://192.168.68.89:30095
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "chore: scaffold weather repo"
```

---

## Task 2: Weather-code mapping (`describeWeather`)

**Files:**
- Create: `weather.js`
- Test: `test/weather.test.js`

- [ ] **Step 1: Write the failing test** — create `test/weather.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather } from '../weather.js';

test('describeWeather: clear day vs night', () => {
  const day = describeWeather(0, 1);
  assert.equal(day.label, 'Clear sky');
  assert.equal(day.icon, 'sun');
  assert.equal(day.theme, 'clear-day');

  const night = describeWeather(0, 0);
  assert.equal(night.icon, 'moon');
  assert.equal(night.theme, 'clear-night');
});

test('describeWeather: partly cloudy switches day/night', () => {
  assert.equal(describeWeather(2, 1).icon, 'partly-day');
  assert.equal(describeWeather(2, 0).icon, 'partly-night');
  assert.equal(describeWeather(2, 1).theme, 'partly-day');
});

test('describeWeather: rain/snow/thunder groups', () => {
  assert.equal(describeWeather(65, 1).icon, 'rain');
  assert.equal(describeWeather(65, 1).theme, 'rain');
  assert.equal(describeWeather(75, 0).icon, 'snow');
  assert.equal(describeWeather(95, 1).icon, 'thunder');
  assert.equal(describeWeather(45, 1).icon, 'fog');
});

test('describeWeather: unknown code falls back', () => {
  const r = describeWeather(123, 1);
  assert.equal(r.label, 'Unknown');
  assert.equal(r.icon, 'cloud');
  assert.equal(r.theme, 'cloudy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../weather.js'` / `describeWeather is not a function`.

- [ ] **Step 3: Write minimal implementation** — create `weather.js`

```js
// Pure, browser-agnostic weather helpers. No DOM/fetch here.

// code -> [label, group]
export const CODE_TABLE = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Dense drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Dense freezing drizzle', 'drizzle'],
  61: ['Slight rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Slight showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm w/ hail', 'thunder'],
  99: ['Thunderstorm w/ heavy hail', 'thunder'],
};

const GROUP_ICON = {
  clear:   (d) => (d ? 'sun' : 'moon'),
  partly:  (d) => (d ? 'partly-day' : 'partly-night'),
  cloudy:  () => 'cloud',
  fog:     () => 'fog',
  drizzle: () => 'rain',
  rain:    () => 'rain',
  snow:    () => 'snow',
  thunder: () => 'thunder',
};

const GROUP_THEME = {
  clear:   (d) => (d ? 'clear-day' : 'clear-night'),
  partly:  (d) => (d ? 'partly-day' : 'partly-night'),
  cloudy:  () => 'cloudy',
  fog:     () => 'fog',
  drizzle: () => 'rain',
  rain:    () => 'rain',
  snow:    () => 'snow',
  thunder: () => 'thunder',
};

export function describeWeather(code, isDay) {
  const day = !!Number(isDay);
  const entry = CODE_TABLE[code];
  const label = entry ? entry[0] : 'Unknown';
  const group = entry ? entry[1] : 'cloudy';
  return {
    label,
    icon: GROUP_ICON[group](day),
    theme: GROUP_THEME[group](day),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add weather.js test/weather.test.js
git commit -m "feat: weather-code to label/icon/theme mapping"
```

---

## Task 3: Time + unit helpers (`floorToHour`, `degToCompass`, `metersToMiles`, `rangeBar`)

**Files:**
- Modify: `weather.js`
- Test: `test/weather.test.js`

- [ ] **Step 1: Add failing tests** — append to `test/weather.test.js`

```js
import {
  floorToHour, degToCompass, metersToMiles, rangeBar,
} from '../weather.js';

test('floorToHour truncates to the hour', () => {
  assert.equal(floorToHour('2026-06-04T21:15'), '2026-06-04T21:00');
  assert.equal(floorToHour('2026-06-04T21:00'), '2026-06-04T21:00');
});

test('degToCompass maps to 8-point compass', () => {
  assert.equal(degToCompass(0), 'N');
  assert.equal(degToCompass(45), 'NE');
  assert.equal(degToCompass(90), 'E');
  assert.equal(degToCompass(200), 'S');
  assert.equal(degToCompass(359), 'N');
});

test('metersToMiles rounds to 1 decimal', () => {
  assert.equal(metersToMiles(1609), 1);
  assert.equal(metersToMiles(16090), 10);
  assert.equal(metersToMiles(8045), 5);
});

test('rangeBar computes left/width percentages', () => {
  const b = rangeBar(60, 78, 55, 80);
  assert.equal(b.left, 20);   // (60-55)/(80-55)=0.2
  assert.equal(b.width, 72);  // (78-60)/(80-55)=0.72
  // degenerate week range -> full-width bar, no NaN
  const flat = rangeBar(70, 70, 70, 70);
  assert.equal(flat.left, 0);
  assert.equal(flat.width, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `floorToHour is not a function`.

- [ ] **Step 3: Implement** — append to `weather.js`

```js
export function floorToHour(iso) {
  return iso.slice(0, 13) + ':00';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function degToCompass(deg) {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

export function metersToMiles(m) {
  return Math.round((m / 1609.344) * 10) / 10;
}

export function rangeBar(min, max, weekMin, weekMax) {
  const span = weekMax - weekMin;
  if (span <= 0) return { left: 0, width: 100 };
  const left = ((min - weekMin) / span) * 100;
  const width = ((max - min) / span) * 100;
  return { left: Math.round(left), width: Math.round(width) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add weather.js test/weather.test.js
git commit -m "feat: time/unit/range helpers"
```

---

## Task 4: Hourly slicing (`sliceNext24`)

**Files:**
- Modify: `weather.js`
- Test: `test/weather.test.js`

- [ ] **Step 1: Add failing test** — append to `test/weather.test.js`

```js
import { sliceNext24 } from '../weather.js';

function fakeHourly(startHour, n) {
  const time = [], temperature_2m = [], weather_code = [],
        is_day = [], precipitation_probability = [],
        uv_index = [], visibility = [];
  for (let i = 0; i < n; i++) {
    const h = String((startHour + i) % 24).padStart(2, '0');
    const day = Math.floor((startHour + i) / 24);
    time.push(`2026-06-${String(4 + day).padStart(2, '0')}T${h}:00`);
    temperature_2m.push(60 + i);
    weather_code.push(i % 3);
    is_day.push(1);
    precipitation_probability.push(i);
    uv_index.push(i % 11);
    visibility.push(16090);
  }
  return { time, temperature_2m, weather_code, is_day,
           precipitation_probability, uv_index, visibility };
}

test('sliceNext24 returns 24 entries starting at the current hour', () => {
  const hourly = fakeHourly(0, 48);
  const out = sliceNext24(hourly, '2026-06-04T05:30');
  assert.equal(out.length, 24);
  assert.equal(out[0].time, '2026-06-04T05:00');
  assert.equal(out[0].temp, 65);
  assert.equal(out[0].precip, 5);
  assert.equal(out[0].uv, 5);
  assert.equal(out[0].visibility, 16090);
});

test('sliceNext24 clamps when near the end of the array', () => {
  const hourly = fakeHourly(0, 10);
  const out = sliceNext24(hourly, '2026-06-04T08:00');
  assert.equal(out.length, 2); // only hours 08,09 remain
});

test('sliceNext24 falls back to index 0 when time not found', () => {
  const hourly = fakeHourly(0, 24);
  const out = sliceNext24(hourly, '1999-01-01T00:00');
  assert.equal(out[0].time, '2026-06-04T00:00');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `sliceNext24 is not a function`.

- [ ] **Step 3: Implement** — append to `weather.js`

```js
export function sliceNext24(hourly, currentIso) {
  const target = floorToHour(currentIso);
  let start = hourly.time.indexOf(target);
  if (start < 0) start = 0;
  const end = Math.min(start + 24, hourly.time.length);
  const out = [];
  for (let i = start; i < end; i++) {
    out.push({
      time: hourly.time[i],
      temp: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
      isDay: hourly.is_day[i],
      precip: hourly.precipitation_probability[i],
      uv: hourly.uv_index[i],
      visibility: hourly.visibility[i],
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add weather.js test/weather.test.js
git commit -m "feat: next-24h hourly slicing"
```

---

## Task 5: URL builders + geocode parsing

**Files:**
- Modify: `weather.js`
- Test: `test/weather.test.js`

- [ ] **Step 1: Add failing tests** — append to `test/weather.test.js`

```js
import {
  forecastUrl, geocodeUrl, reverseGeocodeUrl, parsePlaces,
} from '../weather.js';

test('forecastUrl includes coords, unit, and blocks', () => {
  const u = forecastUrl(47.6, -122.3, 'fahrenheit');
  assert.match(u, /latitude=47\.6/);
  assert.match(u, /longitude=-122\.3/);
  assert.match(u, /temperature_unit=fahrenheit/);
  assert.match(u, /wind_speed_unit=mph/);
  assert.match(u, /timezone=auto/);
  assert.match(u, /current=/);
  assert.match(u, /hourly=/);
  assert.match(u, /daily=/);
  assert.match(u, /uv_index/);
});

test('geocodeUrl encodes the query', () => {
  assert.match(geocodeUrl('San Juan'), /name=San%20Juan/);
  assert.match(geocodeUrl('x'), /count=5/);
});

test('reverseGeocodeUrl includes lat/lon', () => {
  const u = reverseGeocodeUrl(47.6, -122.3);
  assert.match(u, /latitude=47\.6/);
  assert.match(u, /longitude=-122\.3/);
});

test('parsePlaces maps results and handles empties', () => {
  const json = { results: [
    { name: 'Seattle', admin1: 'Washington', country: 'United States',
      latitude: 47.6, longitude: -122.3 },
    { name: 'Paris', country: 'France', latitude: 48.8, longitude: 2.3 },
  ]};
  const out = parsePlaces(json);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Seattle, Washington, United States');
  assert.equal(out[0].lat, 47.6);
  assert.equal(out[1].name, 'Paris, France');
  assert.deepEqual(parsePlaces({}), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `forecastUrl is not a function`.

- [ ] **Step 3: Implement** — append to `weather.js`

```js
const CURRENT = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
  'is_day', 'precipitation', 'weather_code', 'wind_speed_10m',
  'wind_direction_10m', 'surface_pressure',
].join(',');

const HOURLY = [
  'temperature_2m', 'weather_code', 'precipitation_probability',
  'is_day', 'uv_index', 'visibility',
].join(',');

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max',
].join(',');

export function forecastUrl(lat, lon, unit) {
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    temperature_unit: unit,
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

export function geocodeUrl(query) {
  const p = new URLSearchParams({
    name: query, count: 5, language: 'en', format: 'json',
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${p.toString()}`;
}

export function reverseGeocodeUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, localityLanguage: 'en',
  });
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?${p.toString()}`;
}

export function parsePlaces(json) {
  const results = (json && json.results) || [];
  return results.map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
```

Note: `URLSearchParams` encodes spaces as `%20` only when using `.toString()` on
some runtimes vs `+` on others. Node and browsers both emit `+` for spaces by
default via `URLSearchParams`. The test uses `%20`; to keep cross-runtime
consistency, the assertion in Step 1 must match the actual encoding. **After
Step 4, if the geocode test fails on `%20`, change the test assertion to**
`/name=San(\+|%20)Juan/` — do not change the implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (adjust the one geocode assertion per the note if needed).

- [ ] **Step 5: Commit**

```bash
git add weather.js test/weather.test.js
git commit -m "feat: Open-Meteo/BigDataCloud URL builders + place parsing"
```

---

## Task 6: HTML structure + SVG icons

**Files:**
- Create: `index.html`

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="clear-day">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Weather</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Inline SVG icon definitions; referenced via <use href="#icon-..."> -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <symbol id="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><line x1="4" y1="4" x2="6" y2="6"/><line x1="18" y1="18" x2="20" y2="20"/><line x1="4" y1="20" x2="6" y2="18"/><line x1="18" y1="6" x2="20" y2="4"/></g></symbol>
      <symbol id="icon-moon" viewBox="0 0 24 24"><path fill="currentColor" d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></symbol>
      <symbol id="icon-cloud" viewBox="0 0 24 24"><path fill="currentColor" d="M7 18a4 4 0 010-8 5 5 0 019.6-1.3A4.5 4.5 0 0117 18z"/></symbol>
      <symbol id="icon-partly-day" viewBox="0 0 24 24"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><path fill="currentColor" d="M10 19a3.5 3.5 0 010-7 4.4 4.4 0 018.4-1.1A3.9 3.9 0 0118 19z"/></symbol>
      <symbol id="icon-partly-night" viewBox="0 0 24 24"><path fill="currentColor" d="M14 4a5 5 0 00-3.5 8.2A4.4 4.4 0 0118 11a3.9 3.9 0 010 .2A5 5 0 0014 4z" opacity=".9"/><path fill="currentColor" d="M9 19a3.5 3.5 0 010-7 4.4 4.4 0 018.4-1.1A3.9 3.9 0 0117 19z"/></symbol>
      <symbol id="icon-rain" viewBox="0 0 24 24"><path fill="currentColor" d="M7 15a4 4 0 010-8 5 5 0 019.6-1.3A4.5 4.5 0 0117 15z"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="18" x2="7" y2="21"/><line x1="12" y1="18" x2="11" y2="21"/><line x1="16" y1="18" x2="15" y2="21"/></g></symbol>
      <symbol id="icon-snow" viewBox="0 0 24 24"><path fill="currentColor" d="M7 15a4 4 0 010-8 5 5 0 019.6-1.3A4.5 4.5 0 0117 15z"/><g fill="currentColor"><circle cx="8" cy="19" r="1"/><circle cx="12" cy="20" r="1"/><circle cx="16" cy="19" r="1"/></g></symbol>
      <symbol id="icon-fog" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="9" x2="21" y2="9"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="4" y1="17" x2="20" y2="17"/></g></symbol>
      <symbol id="icon-thunder" viewBox="0 0 24 24"><path fill="currentColor" d="M7 14a4 4 0 010-8 5 5 0 019.6-1.3A4.5 4.5 0 0117 14z"/><path fill="currentColor" d="M11 13l-3 5h3l-1 4 4-6h-3z"/></symbol>
    </defs>
  </svg>

  <main class="app">
    <header class="controls">
      <div class="search">
        <input id="search-input" type="text" placeholder="Search city…"
               autocomplete="off" aria-label="Search city">
        <ul id="search-results" class="results" hidden></ul>
      </div>
      <button id="geo-btn" class="icon-btn" title="Use my location" aria-label="Use my location">📍</button>
      <button id="unit-btn" class="unit-toggle" aria-label="Toggle units">°F</button>
    </header>

    <section id="status" class="status" hidden></section>

    <section id="hero" class="hero" hidden>
      <div class="place" id="place-name"></div>
      <div class="now">
        <svg class="hero-icon"><use id="hero-icon-use" href="#icon-sun"></use></svg>
        <div class="temp" id="hero-temp"></div>
      </div>
      <div class="condition" id="hero-condition"></div>
      <div class="hilo">
        <span id="hero-feels"></span> &middot;
        <span id="hero-hi"></span> / <span id="hero-lo"></span>
      </div>
    </section>

    <section id="hourly-card" class="card hourly" hidden>
      <h2 class="card-title">Hourly</h2>
      <div class="hourly-strip" id="hourly-strip"></div>
    </section>

    <section id="daily-card" class="card daily" hidden>
      <h2 class="card-title">7-Day</h2>
      <div class="daily-list" id="daily-list"></div>
    </section>

    <section id="tiles-card" class="tiles" hidden>
      <div class="tile"><span class="tile-label">Wind</span><span class="tile-value" id="t-wind"></span></div>
      <div class="tile"><span class="tile-label">Humidity</span><span class="tile-value" id="t-humidity"></span></div>
      <div class="tile"><span class="tile-label">UV Index</span><span class="tile-value" id="t-uv"></span></div>
      <div class="tile"><span class="tile-label">Sunrise</span><span class="tile-value" id="t-sunrise"></span></div>
      <div class="tile"><span class="tile-label">Sunset</span><span class="tile-value" id="t-sunset"></span></div>
      <div class="tile"><span class="tile-label">Pressure</span><span class="tile-value" id="t-pressure"></span></div>
      <div class="tile"><span class="tile-label">Visibility</span><span class="tile-value" id="t-visibility"></span></div>
    </section>

    <section id="empty" class="empty">
      <p>Search for a city or tap 📍 to use your location.</p>
    </section>
  </main>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it opens**

Open `index.html` in a browser. Expected: the search bar, 📍, and °F button
render; the "Search for a city…" empty state shows; no console errors (app.js
will 404-free once Task 8 lands — for now an empty `app.js` avoids errors).

- [ ] **Step 3: Create an empty `app.js` placeholder so the module load succeeds**

```js
// app.js — populated in Task 8.
```

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "feat: page markup and SVG icon set"
```

---

## Task 7: Styling + theme gradients (`styles.css`)

**Files:**
- Create: `styles.css`

- [ ] **Step 1: Create `styles.css`**

```css
:root {
  --bg: linear-gradient(160deg, #5b9bd5 0%, #add0f3 55%, #fdf6e3 100%);
  --fg: #0f2436;
  --muted: rgba(15, 36, 54, 0.62);
  --card: rgba(255, 255, 255, 0.42);
  --card-border: rgba(255, 255, 255, 0.55);
  --shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
}

/* Theme palettes — set on <html data-theme="..."> */
[data-theme="clear-day"]   { --bg: linear-gradient(160deg,#5b9bd5,#add0f3 55%,#fdf6e3); --fg:#0f2436; --muted:rgba(15,36,54,.62); --card:rgba(255,255,255,.42); }
[data-theme="clear-night"] { --bg: radial-gradient(circle at 30% 8%,#2a3a5c,#0d1320 72%); --fg:#eaf0ff; --muted:rgba(234,240,255,.6); --card:rgba(255,255,255,.08); --card-border:rgba(255,255,255,.12); }
[data-theme="partly-day"]  { --bg: linear-gradient(160deg,#7fa9cf,#cfe0ee 60%,#f3eee2); --fg:#13283b; --muted:rgba(19,40,59,.62); --card:rgba(255,255,255,.4); }
[data-theme="partly-night"]{ --bg: radial-gradient(circle at 30% 8%,#26324c,#11151f 75%); --fg:#e7edfb; --muted:rgba(231,237,251,.58); --card:rgba(255,255,255,.08); --card-border:rgba(255,255,255,.12); }
[data-theme="cloudy"]      { --bg: linear-gradient(160deg,#8a98a8,#c2cad2); --fg:#1c2530; --muted:rgba(28,37,48,.6); --card:rgba(255,255,255,.36); }
[data-theme="fog"]         { --bg: linear-gradient(160deg,#aeb6bd,#d9dde0); --fg:#222a30; --muted:rgba(34,42,48,.6); --card:rgba(255,255,255,.42); }
[data-theme="rain"]        { --bg: linear-gradient(160deg,#4a6175,#7e94a6); --fg:#f2f6fa; --muted:rgba(242,246,250,.62); --card:rgba(255,255,255,.14); --card-border:rgba(255,255,255,.2); }
[data-theme="snow"]        { --bg: linear-gradient(160deg,#9fb3c4,#e8eef3); --fg:#1b2733; --muted:rgba(27,39,51,.6); --card:rgba(255,255,255,.5); }
[data-theme="thunder"]     { --bg: linear-gradient(160deg,#3a3f52,#5b5f73); --fg:#f0f1f7; --muted:rgba(240,241,247,.62); --card:rgba(255,255,255,.12); --card-border:rgba(255,255,255,.18); }

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
  background-attachment: fixed;
  transition: background 0.8s ease, color 0.4s ease;
  min-height: 100vh;
}

.app {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Controls */
.controls { display: flex; gap: 10px; align-items: center; }
.search { position: relative; flex: 1; }
#search-input {
  width: 100%; padding: 12px 14px; font-size: 15px;
  border: 1px solid var(--card-border); border-radius: 14px;
  background: var(--card); color: var(--fg);
  backdrop-filter: blur(8px);
}
#search-input::placeholder { color: var(--muted); }
.results {
  list-style: none; margin: 6px 0 0; padding: 6px;
  position: absolute; left: 0; right: 0; z-index: 5;
  background: var(--card); border: 1px solid var(--card-border);
  border-radius: 14px; backdrop-filter: blur(14px); box-shadow: var(--shadow);
}
.results li { padding: 10px 12px; border-radius: 10px; cursor: pointer; }
.results li:hover { background: rgba(127,127,127,.18); }
.icon-btn, .unit-toggle {
  padding: 12px 14px; font-size: 15px; cursor: pointer;
  border: 1px solid var(--card-border); border-radius: 14px;
  background: var(--card); color: var(--fg); backdrop-filter: blur(8px);
}
.unit-toggle { font-weight: 600; min-width: 52px; }

/* Hero */
.hero { text-align: center; padding: 18px 8px 6px; }
.place { font-size: 15px; color: var(--muted); }
.now { display: flex; align-items: center; justify-content: center; gap: 8px; }
.hero-icon { width: 64px; height: 64px; color: var(--fg); }
.temp { font-size: 84px; font-weight: 200; line-height: 1; }
.temp::after { content: "°"; font-weight: 200; }
.condition { font-size: 18px; margin-top: 2px; }
.hilo { font-size: 14px; color: var(--muted); margin-top: 4px; }

/* Cards */
.card {
  background: var(--card); border: 1px solid var(--card-border);
  border-radius: 20px; padding: 14px 16px; box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
}
.card-title { margin: 0 0 10px; font-size: 12px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--muted); font-weight: 600; }

/* Hourly */
.hourly-strip { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 4px; }
.hour { flex: 0 0 auto; text-align: center; min-width: 48px; }
.hour .h-time { font-size: 12px; color: var(--muted); }
.hour svg { width: 24px; height: 24px; color: var(--fg); margin: 6px 0; }
.hour .h-temp { font-size: 15px; }
.hour .h-precip { font-size: 11px; color: var(--muted); min-height: 14px; }

/* Daily */
.daily-list { display: flex; flex-direction: column; gap: 10px; }
.day-row { display: grid; grid-template-columns: 42px 24px 40px 1fr; align-items: center; gap: 10px; }
.day-row .d-name { font-size: 14px; }
.day-row svg { width: 22px; height: 22px; color: var(--fg); }
.day-row .d-precip { font-size: 12px; color: var(--muted); text-align: right; }
.range { position: relative; height: 6px; border-radius: 3px;
  background: rgba(127,127,127,.25); }
.range-fill { position: absolute; height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, #6ec1ff, #ffd27a); }
.range-lo, .range-hi { font-size: 12px; color: var(--muted); }
.day-range { display: grid; grid-template-columns: 28px 1fr 28px; gap: 8px; align-items: center; }

/* Tiles */
.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.tile {
  background: var(--card); border: 1px solid var(--card-border);
  border-radius: 16px; padding: 14px; backdrop-filter: blur(12px);
  display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow);
}
.tile-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.tile-value { font-size: 20px; font-weight: 500; }

/* Status / empty */
.status, .empty { text-align: center; color: var(--muted); padding: 14px; }
.status.error { color: #b00020; }
[data-theme="rain"] .status.error,
[data-theme="clear-night"] .status.error,
[data-theme="thunder"] .status.error { color: #ffb4a8; }

@media (min-width: 600px) {
  .tiles { grid-template-columns: repeat(3, 1fr); }
}
```

- [ ] **Step 2: Verify visually**

Open `index.html`. Expected: clear-day gradient background, frosted control bar.
Temporarily set `<html data-theme="clear-night">` and confirm the page flips to a
dark palette with light text. Revert to `clear-day`.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: soft/atmospheric styling and theme gradients"
```

---

## Task 8: App wiring (`app.js`)

**Files:**
- Modify: `app.js` (replace placeholder)

- [ ] **Step 1: Replace `app.js` with the full implementation**

```js
import {
  describeWeather, sliceNext24, degToCompass, metersToMiles,
  rangeBar, forecastUrl, geocodeUrl, reverseGeocodeUrl, parsePlaces,
} from './weather.js';

const $ = (id) => document.getElementById(id);
const LS_LOC = 'weather.location';
const LS_UNIT = 'weather.unit';

let unit = localStorage.getItem(LS_UNIT) || 'fahrenheit';
let location_ = loadJSON(LS_LOC); // { name, lat, lon } | null
let lastData = null;
let refreshTimer = null;

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function setUnitLabel() {
  $('unit-btn').textContent = unit === 'fahrenheit' ? '°F' : '°C';
}

function showStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = !msg;
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function iconHref(name) { return `#icon-${name}`; }

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}
function formatHourLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric' });
}
function formatWeekday(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

// ---- Rendering ----

function show(id) { $(id).hidden = false; }

function renderHero(cur, daily, name) {
  const d = describeWeather(cur.weather_code, cur.is_day);
  setTheme(d.theme);
  $('place-name').textContent = name;
  $('hero-temp').textContent = Math.round(cur.temperature_2m);
  $('hero-icon-use').setAttribute('href', iconHref(d.icon));
  $('hero-condition').textContent = d.label;
  $('hero-feels').textContent = `Feels ${Math.round(cur.apparent_temperature)}°`;
  $('hero-hi').textContent = `H ${Math.round(daily.temperature_2m_max[0])}°`;
  $('hero-lo').textContent = `L ${Math.round(daily.temperature_2m_min[0])}°`;
  show('hero');
}

function renderHourly(hours) {
  const strip = $('hourly-strip');
  strip.innerHTML = '';
  hours.forEach((h, i) => {
    const d = describeWeather(h.code, h.isDay);
    const cell = document.createElement('div');
    cell.className = 'hour';
    cell.innerHTML = `
      <div class="h-time">${i === 0 ? 'Now' : formatHourLabel(h.time)}</div>
      <svg><use href="${iconHref(d.icon)}"></use></svg>
      <div class="h-temp">${Math.round(h.temp)}°</div>
      <div class="h-precip">${h.precip > 0 ? h.precip + '%' : ''}</div>`;
    strip.appendChild(cell);
  });
  show('hourly-card');
}

function renderDaily(daily) {
  const list = $('daily-list');
  list.innerHTML = '';
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  daily.time.forEach((iso, i) => {
    const d = describeWeather(daily.weather_code[i], 1);
    const bar = rangeBar(daily.temperature_2m_min[i],
                         daily.temperature_2m_max[i], weekMin, weekMax);
    const precip = daily.precipitation_probability_max[i];
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="d-name">${i === 0 ? 'Today' : formatWeekday(iso)}</span>
      <svg><use href="${iconHref(d.icon)}"></use></svg>
      <span class="d-precip">${precip > 0 ? precip + '%' : ''}</span>
      <span class="day-range">
        <span class="range-lo">${Math.round(daily.temperature_2m_min[i])}°</span>
        <span class="range"><span class="range-fill"
          style="left:${bar.left}%;width:${bar.width}%"></span></span>
        <span class="range-hi">${Math.round(daily.temperature_2m_max[i])}°</span>
      </span>`;
    list.appendChild(row);
  });
  show('daily-card');
}

function renderTiles(cur, daily, firstHour) {
  $('t-wind').textContent =
    `${Math.round(cur.wind_speed_10m)} mph ${degToCompass(cur.wind_direction_10m)}`;
  $('t-humidity').textContent = `${cur.relative_humidity_2m}%`;
  $('t-uv').textContent = Math.round(firstHour ? firstHour.uv : daily.uv_index_max[0]);
  $('t-sunrise').textContent = formatClock(daily.sunrise[0]);
  $('t-sunset').textContent = formatClock(daily.sunset[0]);
  $('t-pressure').textContent = `${Math.round(cur.surface_pressure)} hPa`;
  $('t-visibility').textContent = firstHour
    ? `${metersToMiles(firstHour.visibility)} mi` : '—';
  show('tiles-card');
}

function renderAll(data, name) {
  const hours = sliceNext24(data.hourly, data.current.time);
  renderHero(data.current, data.daily, name);
  renderHourly(hours);
  renderDaily(data.daily);
  renderTiles(data.current, data.daily, hours[0]);
  $('empty').hidden = true;
  showStatus('');
}

// ---- Data flow ----

async function refresh() {
  if (!location_) { $('empty').hidden = false; return; }
  try {
    showStatus('Loading…');
    const res = await fetch(forecastUrl(location_.lat, location_.lon, unit));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastData = data;
    renderAll(data, location_.name);
  } catch (err) {
    showStatus(lastData
      ? 'Could not refresh — showing last data.'
      : `Could not load weather (${err.message}).`, true);
  }
}

function setLocation(loc) {
  location_ = loc;
  localStorage.setItem(LS_LOC, JSON.stringify(loc));
  refresh();
}

async function doSearch(query) {
  const list = $('search-results');
  if (!query.trim()) { list.hidden = true; return; }
  try {
    const res = await fetch(geocodeUrl(query));
    const places = parsePlaces(await res.json());
    list.innerHTML = '';
    if (!places.length) {
      list.innerHTML = '<li class="muted">No place found</li>';
    } else {
      places.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p.name;
        li.addEventListener('click', () => {
          $('search-input').value = '';
          list.hidden = true;
          setLocation(p);
        });
        list.appendChild(li);
      });
    }
    list.hidden = false;
  } catch {
    list.hidden = true;
  }
}

function useMyLocation() {
  if (!navigator.geolocation) { showStatus('Geolocation unavailable.', true); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    let name = 'Current Location';
    try {
      const res = await fetch(reverseGeocodeUrl(lat, lon));
      const j = await res.json();
      name = [j.city, j.principalSubdivision].filter(Boolean).join(', ') || name;
    } catch { /* keep fallback name */ }
    setLocation({ name, lat, lon });
  }, () => {
    showStatus('Location permission denied — search instead.', false);
  });
}

function toggleUnit() {
  unit = unit === 'fahrenheit' ? 'celsius' : 'fahrenheit';
  localStorage.setItem(LS_UNIT, unit);
  setUnitLabel();
  refresh();
}

// ---- Events & init ----

let searchDebounce;
$('search-input').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value;
  searchDebounce = setTimeout(() => doSearch(q), 250);
});
$('geo-btn').addEventListener('click', useMyLocation);
$('unit-btn').addEventListener('click', toggleUnit);
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) $('search-results').hidden = true;
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

setUnitLabel();
refresh();
refreshTimer = setInterval(refresh, 15 * 60 * 1000);
```

- [ ] **Step 2: Run the unit tests (regression check)**

Run: `npm test`
Expected: PASS — all weather.js tests still green (app.js isn't imported by tests).

- [ ] **Step 3: Manual browser verification**

Open `index.html`. Verify in order:
1. Type "Seattle" → dropdown lists matches → click one → hero + hourly + 7-day +
   tiles populate; background gradient matches conditions.
2. Click °F/°C → values change and persist after reload.
3. Reload → it reopens to the saved city automatically.
4. Click 📍 → allow → resolves to a named location (or "Current Location").
5. Open DevTools → offline → reload → "Could not load weather" message; back
   online → recovers.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: app wiring — search, geolocation, units, rendering, refresh"
```

---

## Task 9: Deployment manifests

**Files:**
- Create: `deploy/namespace.yaml`, `deploy/deployment.yaml`, `deploy/service.yaml`, `kustomization.yaml`

- [ ] **Step 1: Create `deploy/namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: weather
```

- [ ] **Step 2: Create `deploy/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: weather
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: weather
  template:
    metadata:
      labels:
        app: weather
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          env:
            - name: TZ
              value: America/New_York
          volumeMounts:
            - name: site
              mountPath: /usr/share/nginx/html
              readOnly: true
          readinessProbe:
            httpGet: { path: /, port: 80 }
            initialDelaySeconds: 3
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /, port: 80 }
            initialDelaySeconds: 10
            periodSeconds: 20
      volumes:
        - name: site
          configMap:
            name: weather-site
```

- [ ] **Step 3: Create `deploy/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: weather
spec:
  type: NodePort
  selector:
    app: weather
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30095
```

- [ ] **Step 4: Create root `kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: weather
resources:
  - deploy/namespace.yaml
  - deploy/deployment.yaml
  - deploy/service.yaml
configMapGenerator:
  - name: weather-site
    files:
      - index.html
      - styles.css
      - weather.js
      - app.js
```

- [ ] **Step 5: Validate the build**

Run: `kustomize build .`  (or `kubectl kustomize .`)
Expected: valid YAML; a `ConfigMap` named `weather-site-<hash>` containing all
four files; Deployment references the generated name; namespace `weather` on all
objects.

- [ ] **Step 6: Commit**

```bash
git add kustomization.yaml deploy/
git commit -m "feat: k8s manifests — nginx + ConfigMap site + NodePort 30095"
```

---

## Task 10: Create GitHub repo and push

**Files:** none (repo operations)

- [ ] **Step 1: Confirm the GitHub owner**

The otter-flux remote is `github.com/disappointment/otter-flux`. Confirm the
weather repo will be `github.com/disappointment/weather` (public). If the owner
differs, use the actual owner in the URL and in Task 11's `clusters/otter/weather.yaml`.

- [ ] **Step 2: Create the public repo and push**

```bash
gh repo create disappointment/weather --public --source=. --remote=origin --push
```

Expected: repo created; `main` pushed; `gh repo view --web` shows the files.

- [ ] **Step 3: Verify raw access (Flux will pull over HTTPS)**

Run: `gh repo view disappointment/weather --json visibility`
Expected: `"visibility":"PUBLIC"`.

---

## Task 11: Wire Flux in otter-flux

**Files (in the `otter-flux` repo, `C:\Gitrepos\otter-flux`):**
- Create: `clusters/otter/weather.yaml`
- Modify: `apps/homepage/config/services.yaml`, `CLAUDE.md`

- [ ] **Step 1: Create `clusters/otter/weather.yaml`**

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: weather
  namespace: flux-system
spec:
  interval: 1m
  ref:
    branch: main
  url: https://github.com/disappointment/weather
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: weather
  namespace: flux-system
spec:
  interval: 10m
  prune: true
  sourceRef:
    kind: GitRepository
    name: weather
  path: ./
```

- [ ] **Step 2: Add the Homepage tile**

Open `apps/homepage/config/services.yaml`, find an appropriate section header,
and add (match the file's existing indentation/style):

```yaml
    - Weather:
        href: http://192.168.68.89:30095
        description: Local weather forecast
        icon: mdi-weather-partly-cloudy
```

- [ ] **Step 3: Update the port table in `otter-flux/CLAUDE.md`**

Add a row `| 30095 | Weather     |` to the NodePort table and change
"Next available" from **30095** to **30096**.

- [ ] **Step 4: Commit and push otter-flux**

```bash
cd /c/Gitrepos/otter-flux
git add clusters/otter/weather.yaml apps/homepage/config/services.yaml CLAUDE.md
git commit -m "feat: add weather app (Flux source + homepage tile + port 30095)"
git push
```

- [ ] **Step 5: Reconcile and restart homepage**

```bash
ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl annotate gitrepository/flux-system -n flux-system reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite'
```

Then (after the new `weather` GitRepository/Kustomization are applied):

```bash
ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl annotate gitrepository/weather -n flux-system reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite'
ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n homepage rollout restart deploy/homepage'
```

---

## Task 12: Verify on the cluster

**Files:** none

- [ ] **Step 1: Confirm Flux reconciled the app**

```bash
ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get kustomization weather -n flux-system'
ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n weather get pods,svc,configmap'
```

Expected: Kustomization `weather` READY=True; pod `weather-*` Running; service
`weather` NodePort 30095; a `weather-site-<hash>` ConfigMap present.

- [ ] **Step 2: Load the page**

From a house machine, open `http://192.168.68.89:30095`. Expected: the weather
page loads, search works, gradient renders. Confirm the Homepage dashboard shows
the new "Weather" tile.

- [ ] **Step 3: Add the Uptime Kuma monitor**

Via the Uptime Kuma UI at `http://192.168.68.89:30088`, add an HTTP monitor for
`http://192.168.68.89:30095` and attach it to the "homelab" status page (per
otter-flux conventions).

---

## Self-Review Notes

- **Spec coverage:** search+geolocation (Tasks 5, 8), current/hourly/7-day/tiles
  (Tasks 4, 8, 6), °F default+toggle (Task 8), condition-reactive themes (Tasks
  2, 7, 8), localStorage persistence + auto-refresh (Task 8), error/edge handling
  (Task 8), ConfigMap+nginx hosting (Task 9), Flux-pulls-repo wiring (Tasks 10–11),
  homepage tile + uptime kuma + port table (Tasks 11–12). All covered.
- **Deviation from spec:** JS split into `weather.js` (pure, tested) + `app.js`
  (DOM). ConfigMap lists four files instead of three — reflected in Task 9.
- **Name consistency:** exported function names in Tasks 2–5 match their imports
  in Task 8 and the File Structure list.
- **Cross-runtime note:** the one geocode URL-encoding assertion has an explicit
  fallback in Task 5 to avoid a `+` vs `%20` false failure.
```

