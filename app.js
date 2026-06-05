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
