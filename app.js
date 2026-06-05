import {
  describeWeather, sliceNext24, degToCompass, unitConfig, lineGraph,
  rangeBar, forecastUrl, geocodeUrl, reverseGeocodeUrl, parsePlaces,
  parseLocationParams, locationQuery,
} from './weather.js';

const $ = (id) => document.getElementById(id);
const LS_LOC = 'weather.location';
const LS_UNIT = 'weather.unit';
const LS_DATA = 'weather.lastData';
const LS_METRIC = 'weather.metric';

let unit = localStorage.getItem(LS_UNIT) || 'fahrenheit';
let location_ = loadJSON(LS_LOC); // { name, lat, lon } | null
let lastData = null;
let lastHours = [];               // sliced hourly data, kept for metric re-renders
let hourlyMetric = localStorage.getItem(LS_METRIC) || 'temp';
let refreshTimer = null;
let forecastController = null; // aborts in-flight forecast fetches
let searchController = null;    // aborts in-flight search fetches

// Search/combobox state
let currentPlaces = [];
let activeIndex = -1;

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function setUnitLabel() {
  $('unit-btn').textContent = unit === 'fahrenheit' ? '°F' : '°C';
}

function showStatus(msg, isError = false) {
  const el = $('status');
  // Errors interrupt; routine status is announced politely.
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
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
function formatUpdated(date) {
  return 'Updated ' + date.toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}

// ---- Rendering ----

function show(id) { $(id).hidden = false; }

function renderHero(cur, daily, name) {
  const d = describeWeather(cur.weather_code, cur.is_day);
  setTheme(d.theme);
  $('place-name').textContent = name;
  $('hero-temp').textContent = Math.round(cur.temperature_2m);
  $('hero-icon-use').closest('svg').dataset.icon = d.icon;
  $('hero-icon-use').setAttribute('href', iconHref(d.icon));
  $('hero-condition').textContent = d.label;
  $('hero-feels').textContent = `Feels ${Math.round(cur.apparent_temperature)}°`;
  $('hero-hi').textContent = `H ${Math.round(daily.temperature_2m_max[0])}°`;
  $('hero-lo').textContent = `L ${Math.round(daily.temperature_2m_min[0])}°`;
  show('hero');
}

// Cell geometry must match the CSS: .hour is HOUR_CELL wide with HOUR_GAP between.
const HOUR_CELL = 58;
const HOUR_GAP = 10;
const GRAPH_H = 40;
const GRAPH_PAD = 6;

// Hourly graph metrics (Google-style toggle). Each maps an hour to a value,
// formats the per-cell label, and pins the graph's y-domain where it matters.
const METRICS = {
  temp: {
    label: 'Temp',
    value: (h) => h.temp,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—'),
    domain: () => ({}), // auto min/max — temperature is about the shape
  },
  precip: {
    label: 'Precip',
    value: (h) => h.precip,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—'),
    domain: () => ({ min: 0, max: 100 }), // probability is absolute 0–100
  },
  wind: {
    label: 'Wind',
    value: (h) => h.wind,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)}` : '—'),
    domain: () => ({ min: 0 }), // baseline at calm
  },
};

function metricGraphSvg(hours, metric) {
  const m = METRICS[metric] || METRICS.temp;
  const geom = {
    pitch: HOUR_CELL + HOUR_GAP,
    offsetX: HOUR_CELL / 2,
    height: GRAPH_H,
    padY: GRAPH_PAD,
  };
  const g = lineGraph(hours.map(m.value), geom, m.domain());
  if (!g.points.length) return ''; // not enough data to draw a curve
  const width = HOUR_CELL + (HOUR_CELL + HOUR_GAP) * (hours.length - 1);
  const dots = g.points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="1.7"/>`).join('');
  return `
    <svg class="hourly-graph" width="${width}" height="${GRAPH_H}"
         viewBox="0 0 ${width} ${GRAPH_H}" aria-hidden="true">
      <path class="graph-area" d="${g.area}"/>
      <path class="graph-line" d="${g.line}"/>
      <g class="graph-dots">${dots}</g>
    </svg>`;
}

function renderHourly(hours) {
  const strip = $('hourly-strip');
  const m = METRICS[hourlyMetric] || METRICS.temp;
  // Metric curve as a ribbon across the top of the strip; it scrolls with the
  // cells because it shares the scroll container and matches their pitch.
  strip.innerHTML = metricGraphSvg(hours, hourlyMetric);
  const frag = document.createDocumentFragment();
  hours.forEach((h, i) => {
    const d = describeWeather(h.code, h.isDay);
    const cell = document.createElement('div');
    cell.className = 'hour';
    cell.innerHTML = `
      <div class="h-time">${i === 0 ? 'Now' : formatHourLabel(h.time)}</div>
      <svg data-icon="${d.icon}" viewBox="0 0 24 24" aria-hidden="true"><use href="${iconHref(d.icon)}"></use></svg>
      <div class="h-val">${m.cell(m.value(h))}</div>`;
    frag.appendChild(cell);
  });
  strip.appendChild(frag);
  syncMetricToggle();
  show('hourly-card');
}

function syncMetricToggle() {
  document.querySelectorAll('#metric-toggle .seg-btn').forEach((btn) => {
    const on = btn.dataset.metric === hourlyMetric;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setMetric(metric) {
  if (!METRICS[metric]) return;
  hourlyMetric = metric;
  localStorage.setItem(LS_METRIC, metric);
  if (lastHours.length) renderHourly(lastHours);
  else syncMetricToggle();
}

function renderDaily(daily) {
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const frag = document.createDocumentFragment();
  daily.time.forEach((iso, i) => {
    const d = describeWeather(daily.weather_code[i], 1);
    const bar = rangeBar(daily.temperature_2m_min[i],
                         daily.temperature_2m_max[i], weekMin, weekMax);
    const precip = daily.precipitation_probability_max[i];
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="d-name">${i === 0 ? 'Today' : formatWeekday(iso)}</span>
      <svg data-icon="${d.icon}" viewBox="0 0 24 24" aria-hidden="true"><use href="${iconHref(d.icon)}"></use></svg>
      <span class="d-precip">${precip > 0 ? precip + '%' : ''}</span>
      <span class="day-range">
        <span class="range-lo">${Math.round(daily.temperature_2m_min[i])}°</span>
        <span class="range"><span class="range-fill"
          style="left:${bar.left}%;width:${bar.width}%"></span></span>
        <span class="range-hi">${Math.round(daily.temperature_2m_max[i])}°</span>
      </span>`;
    frag.appendChild(row);
  });
  $('daily-list').replaceChildren(frag);
  show('daily-card');
}

function renderTiles(cur, daily, firstHour) {
  const u = unitConfig(unit);
  $('t-wind').textContent =
    `${Math.round(cur.wind_speed_10m)} ${u.windLabel} ${degToCompass(cur.wind_direction_10m)}`;
  $('t-humidity').textContent = `${cur.relative_humidity_2m}%`;
  $('t-uv').textContent = Math.round(firstHour ? firstHour.uv : daily.uv_index_max[0]);
  $('t-sunrise').textContent = formatClock(daily.sunrise[0]);
  $('t-sunset').textContent = formatClock(daily.sunset[0]);
  $('t-pressure').textContent = `${Math.round(cur.surface_pressure)} hPa`;
  $('t-visibility').textContent = firstHour
    ? `${u.distanceFrom(firstHour.visibility)} ${u.distanceLabel}` : '—';
  show('tiles-card');
}

function setUpdated(date) {
  $('updated-time').textContent = date ? formatUpdated(date) : '';
  $('refresh-btn').hidden = false;
}

function renderAll(data, name, updatedAt) {
  lastHours = sliceNext24(data.hourly, data.current.time);
  renderHero(data.current, data.daily, name);
  renderHourly(lastHours);
  renderDaily(data.daily);
  renderTiles(data.current, data.daily, lastHours[0]);
  $('empty').hidden = true;
  showStatus('');
  setUpdated(updatedAt);
}

// ---- Data flow ----

function sameLoc(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
}

function persist(data) {
  try {
    localStorage.setItem(LS_DATA,
      JSON.stringify({ data, loc: location_, savedAt: Date.now() }));
  } catch { /* storage full or unavailable — best effort */ }
}

// Paint the last good forecast immediately so reloads/offline opens aren't blank,
// but only when the cache is for the location we're actually showing.
function hydrateFromCache() {
  if (!location_) return;
  const cached = loadJSON(LS_DATA);
  if (cached && cached.data && sameLoc(cached.loc, location_)) {
    lastData = cached.data;
    renderAll(cached.data, location_.name,
      cached.savedAt ? new Date(cached.savedAt) : null);
  }
}

async function refresh() {
  if (!location_) { $('empty').hidden = false; return; }
  forecastController?.abort();
  forecastController = new AbortController();
  const { signal } = forecastController;
  try {
    if (!lastData) showStatus('Loading…');
    const res = await fetch(forecastUrl(location_.lat, location_.lon, unit), { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastData = data;
    persist(data);
    renderAll(data, location_.name, new Date());
  } catch (err) {
    if (err.name === 'AbortError') return; // superseded by a newer request
    showStatus(lastData
      ? 'Could not refresh — showing last data.'
      : `Could not load weather (${err.message}).`, true);
  }
}

// Reflect the active location in the URL so it can be bookmarked/shared.
// replaceState (not push) keeps the back button from filling with cities.
function syncUrl(loc) {
  window.history.replaceState(null, '',
    `${window.location.pathname}?${locationQuery(loc)}`);
}

function setLocation(loc) {
  location_ = loc;
  localStorage.setItem(LS_LOC, JSON.stringify(loc));
  syncUrl(loc);
  refresh();
}

// ---- Search (combobox) ----

function mutedItem(text) {
  const li = document.createElement('li');
  li.className = 'muted';
  li.textContent = text;
  return li;
}

function openResults() {
  $('search-results').hidden = false;
  $('search-input').setAttribute('aria-expanded', 'true');
}

function closeResults() {
  $('search-results').hidden = true;
  $('search-input').setAttribute('aria-expanded', 'false');
  $('search-input').setAttribute('aria-activedescendant', '');
  activeIndex = -1;
}

function selectPlace(i) {
  const p = currentPlaces[i];
  if (!p) return;
  $('search-input').value = '';
  closeResults();
  setLocation(p);
}

function moveActive(delta) {
  if (!currentPlaces.length) return;
  activeIndex = (activeIndex + delta + currentPlaces.length) % currentPlaces.length;
  const items = $('search-results').querySelectorAll('[role="option"]');
  items.forEach((el, i) => {
    const on = i === activeIndex;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('search-input').setAttribute('aria-activedescendant',
    activeIndex >= 0 ? `result-${activeIndex}` : '');
}

async function doSearch(query) {
  const list = $('search-results');
  if (!query.trim()) { closeResults(); return; }
  searchController?.abort();
  searchController = new AbortController();
  try {
    const res = await fetch(geocodeUrl(query), { signal: searchController.signal });
    if (!res.ok) throw new Error('search failed');
    const places = parsePlaces(await res.json());
    currentPlaces = places;
    activeIndex = -1;
    const frag = document.createDocumentFragment();
    if (!places.length) {
      frag.appendChild(mutedItem('No place found'));
    } else {
      places.forEach((p, i) => {
        const li = document.createElement('li');
        li.id = `result-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = p.name;
        li.addEventListener('click', () => selectPlace(i));
        frag.appendChild(li);
      });
    }
    list.replaceChildren(frag);
    openResults();
  } catch (err) {
    if (err.name === 'AbortError') return; // a newer keystroke superseded this
    currentPlaces = [];
    list.replaceChildren(mutedItem('Search failed — try again'));
    openResults();
  }
}

// ---- Geolocation ----

function useMyLocation() {
  if (!navigator.geolocation) { showStatus('Geolocation unavailable.', true); return; }
  showStatus('Locating…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    let name = 'Current Location';
    try {
      const res = await fetch(reverseGeocodeUrl(lat, lon));
      if (res.ok) {
        const j = await res.json();
        name = [j.city, j.principalSubdivision].filter(Boolean).join(', ') || name;
      }
    } catch { /* keep fallback name */ }
    setLocation({ name, lat, lon });
  }, (err) => {
    // 1 = permission denied (soft), 2 = unavailable, 3 = timeout
    const map = {
      1: ['Location permission denied — search instead.', false],
      2: ['Location unavailable — search a city instead.', true],
      3: ['Location request timed out — try again.', true],
    };
    const [msg, isErr] = map[err.code] || ['Could not get your location — search instead.', true];
    showStatus(msg, isErr);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
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
$('search-input').addEventListener('keydown', (e) => {
  const open = !$('search-results').hidden;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (open) moveActive(1); else doSearch($('search-input').value);
      break;
    case 'ArrowUp':
      if (open) { e.preventDefault(); moveActive(-1); }
      break;
    case 'Enter':
      if (open && activeIndex >= 0) { e.preventDefault(); selectPlace(activeIndex); }
      break;
    case 'Escape':
      closeResults();
      break;
  }
});
$('geo-btn').addEventListener('click', useMyLocation);
$('unit-btn').addEventListener('click', toggleUnit);
$('refresh-btn').addEventListener('click', () => refresh());
$('metric-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setMetric(btn.dataset.metric);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) closeResults();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

// A location in the URL (a bookmark/shared link) wins over the saved one.
location_ = parseLocationParams(window.location.search) || location_;
if (location_) {
  localStorage.setItem(LS_LOC, JSON.stringify(location_));
  syncUrl(location_); // normalize bare/saved visits into a shareable URL
}

setUnitLabel();
syncMetricToggle();
hydrateFromCache();
refresh();
refreshTimer = setInterval(refresh, 15 * 60 * 1000);

// ---- Service worker (offline app shell) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
  });
}
