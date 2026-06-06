import {
  describeWeather, sliceNext24, groupHours, degToCompass, unitConfig,
  rangeBar, forecastUrl, geocodeUrl, reverseGeocodeUrl, parsePlaces,
  parseLocationParams, locationQuery,
} from './weather.js';

const $ = (id) => document.getElementById(id);
const LS_LOC = 'weather.location';
const LS_UNIT = 'weather.unit';
const LS_DATA = 'weather.lastData';
const LS_METRIC = 'weather.metric';
const LS_ICON_SET = 'weather.iconSet';

let unit = localStorage.getItem(LS_UNIT) || 'fahrenheit';
let iconSet = localStorage.getItem(LS_ICON_SET) || 'illustrated';
let location_ = loadJSON(LS_LOC); // { name, lat, lon } | null
let lastData = null;
let lastUpdatedAt = null;
let lastHours = [];               // 3-hour blocks, kept for cell re-renders
let lastHourlyRaw = [];           // raw hourly samples, kept for the graph curve
let hourlyMetric = localStorage.getItem(LS_METRIC) || 'temp';
let refreshTimer = null;
let forecastController = null; // aborts in-flight forecast fetches
let searchController = null;    // aborts in-flight search fetches
let hourlyRenderId = 0;

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

function setIconSetControl() {
  const active = ICON_SETS.has(iconSet) ? iconSet : 'illustrated';
  $('icon-set-label').textContent = ICON_SET_LABELS[active];
  $('icon-set-menu').querySelectorAll('[role="option"]').forEach((option) => {
    const selected = option.dataset.iconSet === active;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    option.classList.toggle('active', selected);
  });
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

const ICON_SETS = new Set(['illustrated', 'emoji', 'line', 'mono', 'vivid']);
const EMOJI_ICON = {
  sun: '☀️',
  moon: '🌙',
  'partly-day': '🌤️',
  'partly-night': '☁️',
  cloud: '☁️',
  rain: '🌧️',
  snow: '❄️',
  fog: '🌫️',
  thunder: '⛈️',
};
const VIVID_ICON = {
  sun: '🌞',
  moon: '🌜',
  'partly-day': '⛅',
  'partly-night': '🌥️',
  cloud: '☁️',
  rain: '🌧️',
  snow: '🌨️',
  fog: '🌫️',
  thunder: '⛈️',
};
const LINE_ICON = {
  sun: '☼',
  moon: '☾',
  'partly-day': '◐',
  'partly-night': '◑',
  cloud: '☁',
  rain: '☔',
  snow: '✻',
  fog: '≋',
  thunder: 'ϟ',
};
const ICON_SET_LABELS = {
  illustrated: 'Illustrated',
  emoji: 'Emoji',
  line: 'Line',
  mono: 'Mono',
  vivid: 'Vivid',
};

function weatherIconHtml(name, className = 'weather-icon') {
  const wrap = (inner, extra = '') => `<span class="${className} weather-icon-box${extra}" data-icon="${name}" aria-hidden="true">${inner}</span>`;
  if (iconSet === 'emoji') {
    return wrap(`<span class="weather-emoji">${EMOJI_ICON[name] || '☁️'}</span>`);
  }
  if (iconSet === 'vivid') {
    return wrap(`<span class="weather-emoji">${VIVID_ICON[name] || '☁️'}</span>`);
  }
  if (iconSet === 'line') {
    return wrap(`<span class="weather-line">${LINE_ICON[name] || '☁'}</span>`);
  }
  if (iconSet === 'mono') {
    return wrap(`<svg viewBox="0 0 24 24"><use href="${iconHref(`mono-${name}`)}"></use></svg>`, ' weather-icon-mono');
  }
  return wrap(`<svg viewBox="0 0 24 24"><use href="${iconHref(name)}"></use></svg>`);
}

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
function formatDayLabel(iso, i) {
  return i === 0 ? 'today' : formatWeekday(iso);
}
function sentenceCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
function formatUpdated(date) {
  return 'Updated ' + date.toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}
function formatValue(v, suffix = '') {
  return Number.isFinite(v) ? `${Math.round(v)}${suffix}` : '—';
}
function uvCategory(v) {
  if (!Number.isFinite(v)) return 'Unknown';
  if (v < 3) return 'Low';
  if (v < 6) return 'Moderate';
  if (v < 8) return 'High';
  if (v < 11) return 'Very high';
  return 'Extreme';
}
function formatUv(v) {
  return Number.isFinite(v) ? `${Math.round(v)} (${uvCategory(v)})` : '—';
}

// ---- Rendering ----

function show(id) { $(id).hidden = false; }

function setDetail(el, text) {
  if (!el) return;
  el.dataset.detail = text;
  el.title = text;
  el.classList.add('detail-target');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
}

function renderHero(cur, daily, name) {
  const d = describeWeather(cur.weather_code, cur.is_day);
  const u = unitConfig(unit);
  setTheme(d.theme);
  show('hero-shell');
  $('place-name').textContent = name;
  $('hero-temp').textContent = Math.round(cur.temperature_2m);
  $('hero-icon-slot').innerHTML = weatherIconHtml(d.icon, 'hero-icon weather-icon');
  $('hero-condition').textContent = d.label;
  $('hero-feels').textContent = `Feels ${Math.round(cur.apparent_temperature)}°`;
  $('hero-hi').textContent = `H ${Math.round(daily.temperature_2m_max[0])}°`;
  $('hero-lo').textContent = `L ${Math.round(daily.temperature_2m_min[0])}°`;
  setDetail($('hero-shell'),
    `${name}: ${d.label}, ${Math.round(cur.temperature_2m)}° and feels like ${Math.round(cur.apparent_temperature)}°. ` +
    `High ${Math.round(daily.temperature_2m_max[0])}°, low ${Math.round(daily.temperature_2m_min[0])}°. ` +
    `Wind ${Math.round(cur.wind_speed_10m)} ${u.windLabel} ${degToCompass(cur.wind_direction_10m)}; humidity ${cur.relative_humidity_2m}%.`);
  show('hero');
}

const GRAPH_H = 84;
const GRAPH_PAD = 10;

// Hourly graph metrics (Google-style toggle). Each maps an hour to a value,
// formats the per-cell label, and pins the graph's y-domain where it matters.
const METRICS = {
  temp: {
    label: 'Temp',
    value: (h) => h.temp,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—'),
    // Secondary per-cell readout shown under the temp (temp view only).
    sub: (h) => (Number.isFinite(h.humidity) ? `${Math.round(h.humidity)}%` : '—'),
    axis: (v) => `${Math.round(v)}°`,
    domain: () => ({}), // auto min/max — temperature is about the shape
  },
  precip: {
    label: 'Precip',
    value: (h) => h.precip,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—'),
    axis: (v) => `${Math.round(v)}%`,
    domain: () => ({ min: 0, max: 100 }), // probability is absolute 0–100
  },
  wind: {
    label: 'Wind',
    value: (h) => h.wind,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(v)} ${unitConfig(unit).windLabel}` : '—'),
    axis: (v) => `${Math.round(v)} ${unitConfig(unit).windLabel}`,
    domain: () => ({ min: 0 }), // baseline at calm
  },
};

function maxBy(items, getValue) {
  return items.reduce((best, item, index) => {
    const value = Number(getValue(item, index));
    if (!Number.isFinite(value)) return best;
    return !best || value > best.value ? { item, index, value } : best;
  }, null);
}

function summarizeHourly(hours) {
  const warmest = maxBy(hours, (h) => h.temp);
  const wettest = maxBy(hours, (h) => h.precip);
  const windiest = maxBy(hours, (h) => h.wind);
  const parts = [];

  if (warmest) {
    parts.push(`Warmest around ${formatHourLabel(warmest.item.time)} (${Math.round(warmest.value)}°)`);
  }

  if (wettest && wettest.value >= 50) {
    parts.push(`wettest around ${formatHourLabel(wettest.item.time)} (${Math.round(wettest.value)}%)`);
  } else if (wettest && wettest.value >= 25) {
    parts.push(`some rain chance, peaking near ${formatHourLabel(wettest.item.time)}`);
  } else {
    parts.push('low rain chance');
  }

  if (windiest && windiest.value >= 18) {
    parts.push(`breeziest near ${formatHourLabel(windiest.item.time)}`);
  }

  return parts.join('; ') + '.';
}

function summarizeDaily(daily) {
  const days = daily.time.map((time, index) => ({
    time,
    index,
    high: daily.temperature_2m_max[index],
    low: daily.temperature_2m_min[index],
    precip: daily.precipitation_probability_max[index],
    code: daily.weather_code[index],
  }));
  const today = days[0];
  const warmest = maxBy(days, (d) => d.high);
  const wettest = maxBy(days, (d) => d.precip);
  const parts = [];

  if (today) {
    const condition = sentenceCase(describeWeather(today.code, 1).label.toLowerCase());
    parts.push(`${condition} today, ${Math.round(today.high)}°/${Math.round(today.low)}°`);
  }

  if (wettest && wettest.value >= 30) {
    parts.push(`rain odds highest ${formatDayLabel(wettest.item.time, wettest.index)} (${Math.round(wettest.value)}%)`);
  } else {
    parts.push('mostly low rain odds this week');
  }

  if (warmest && warmest.index > 0) {
    parts.push(`warmest ${formatDayLabel(warmest.item.time, warmest.index)}`);
  }

  return parts.join('; ') + '.';
}

function daylightCodesForDate(hourly, dateIso) {
  if (!hourly?.time) return [];
  const codes = [];
  hourly.time.forEach((time, i) => {
    if (!time.startsWith(dateIso) || !Number(hourly.is_day?.[i])) return;
    const code = hourly.weather_code?.[i];
    if (Number.isFinite(code)) codes.push(code);
  });
  return codes;
}

function dailyDisplayCode(dailyCode, hourly, dateIso) {
  const codes = daylightCodesForDate(hourly, dateIso);
  if (!codes.length) return dailyCode;

  const hasSunBreaks = codes.some((code) => [0, 1, 2].includes(code));
  const hasClouds = codes.some((code) => [2, 3].includes(code));
  if ([0, 1, 2, 3].includes(dailyCode) && hasSunBreaks && hasClouds) return 2;

  return dailyCode;
}

function hourlyDetail(h) {
  const d = describeForecastIcon(h.code, h.isDay, h.precip);
  const u = unitConfig(unit);
  return `${formatHourLabel(h.time)}: ${d.label}. ` +
    `Temp ${formatValue(h.temp, '°')}; humidity ${formatValue(h.humidity, '%')}; ` +
    `rain chance ${formatValue(h.precip, '%')}; ` +
    `wind ${Number.isFinite(h.wind) ? `${Math.round(h.wind)} ${u.windLabel}` : '—'}.`;
}

function dailyDetail(daily, i, hourly) {
  const label = i === 0 ? 'Today' : formatWeekday(daily.time[i]);
  const code = dailyDisplayCode(daily.weather_code[i], hourly, daily.time[i]);
  const d = describeForecastIcon(code, 1, daily.precipitation_probability_max[i]);
  const precip = daily.precipitation_probability_max[i];
  return `${label}: ${d.label}. ` +
    `High ${formatValue(daily.temperature_2m_max[i], '°')}, low ${formatValue(daily.temperature_2m_min[i], '°')}. ` +
    `Rain chance ${formatValue(precip, '%')}; UV max ${formatUv(daily.uv_index_max[i])}. ` +
    `Sunrise ${formatClock(daily.sunrise[i])}; sunset ${formatClock(daily.sunset[i])}.`;
}

function describeForecastIcon(code, isDay, precip) {
  const d = describeWeather(code, isDay);
  if (Number.isFinite(precip) && precip >= 35 && !['rain', 'snow', 'thunder'].includes(d.icon)) {
    return { ...d, icon: 'rain', label: precip >= 60 ? 'Rain likely' : 'Rain possible' };
  }
  return d;
}

function pathFromPoints(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// xOf maps an hourly index to its pixel x. The curve carries a point per hour;
// labelEvery keeps the per-point value text at the cell cadence (every 3rd).
function metricGraphSvg(hours, metric, width, xOf, labelEvery = 3) {
  const m = METRICS[metric] || METRICS.temp;
  const valid = hours
    .map((h, i) => ({ value: Number(m.value(h)), x: xOf(i), index: i }))
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.x));
  if (valid.length < 2 || !Number.isFinite(width) || width <= 0) return '';

  const domain = m.domain();
  let min = Number.isFinite(domain.min) ? domain.min : Math.min(...valid.map((p) => p.value));
  let max = Number.isFinite(domain.max) ? domain.max : Math.max(...valid.map((p) => p.value));
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const drawable = GRAPH_H - GRAPH_PAD * 2;
  const points = valid.map((p) => {
    const clamped = Math.max(min, Math.min(max, p.value));
    const y = GRAPH_PAD + ((max - clamped) / (max - min)) * drawable;
    return { x: p.x, y, value: p.value, index: p.index };
  });
  const line = pathFromPoints(points);
  const first = points[0];
  const last = points[points.length - 1];
  const topY = GRAPH_PAD;
  const bottomY = GRAPH_H - GRAPH_PAD;
  const area = `${line} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`;
  const dots = points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.7"/>`).join('');
  const valueLabels = points
    .filter((p) => p.index % labelEvery === 0)
    .map((p) => {
      const y = p.y < 20 ? p.y + 15 : p.y - 8;
      return `<text x="${p.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${m.axis(p.value)}</text>`;
    })
    .join('');
  const labelX = 4;
  const topLabel = m.axis(max);
  const bottomLabel = m.axis(min);
  return `
    <svg class="hourly-graph" width="${width}" height="${GRAPH_H}"
         viewBox="0 0 ${width} ${GRAPH_H}" aria-hidden="true">
      <g class="graph-axis">
        <line x1="0" y1="${topY}" x2="${width}" y2="${topY}"/>
        <line x1="0" y1="${bottomY}" x2="${width}" y2="${bottomY}"/>
        <text x="${labelX}" y="${topY + 3}" text-anchor="start">${topLabel}</text>
        <text x="${labelX}" y="${bottomY + 3}" text-anchor="start">${bottomLabel}</text>
      </g>
      <path class="graph-area" d="${area}"/>
      <path class="graph-line" d="${line}"/>
      <g class="graph-values">${valueLabels}</g>
      <g class="graph-dots">${dots}</g>
    </svg>`;
}

// hours here are the raw hourly samples. Cells sit at every 3rd hour, so we read
// their centers and interpolate a per-hour pitch to place a dot on each hour.
function renderHourlyGraph(strip, hours, metric, renderId) {
  requestAnimationFrame(() => {
    if (renderId !== hourlyRenderId) return;
    strip.querySelector('.hourly-graph')?.remove();
    const cells = [...strip.querySelectorAll('.hour')];
    if (cells.length < 2 || hours.length < 2) return;

    const stripRect = strip.getBoundingClientRect();
    const centers = cells.map((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.left - stripRect.left + rect.width / 2;
    });
    const pitch = (centers[1] - centers[0]) / 3; // px per hour (cells are 3-hourly)
    const xOf = (i) => centers[0] + i * pitch;
    // Keep the curve within the cells' span so the SVG never widens the
    // scroll area. scrollWidth here is the cells-only extent (graph not yet in).
    const maxIndex = (cells.length - 1) * 3;
    const series = hours.slice(0, maxIndex + 1);
    const contentWidth = Math.max(strip.clientWidth, strip.scrollWidth);
    strip.insertAdjacentHTML('afterbegin', metricGraphSvg(series, metric, contentWidth, xOf));
  });
}

function renderHourly(hours) {
  const strip = $('hourly-strip');
  const m = METRICS[hourlyMetric] || METRICS.temp;
  const renderId = ++hourlyRenderId;
  strip.textContent = '';
  strip.style.setProperty('--hour-count', Math.max(hours.length, 1));
  const hasSub = typeof m.sub === 'function';
  strip.classList.toggle('show-sub', hasSub);
  const frag = document.createDocumentFragment();
  hours.forEach((h) => {
    const d = describeForecastIcon(h.code, h.isDay, h.precip);
    const cell = document.createElement('div');
    cell.className = 'hour';
    cell.innerHTML = `
      <div class="h-time">${formatHourLabel(h.time)}</div>
      ${weatherIconHtml(d.icon)}
      <div class="h-val">${m.cell(m.value(h))}</div>
      ${hasSub ? `<div class="h-sub"><svg class="h-sub-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-humidity"></use></svg>${m.sub(h)}</div>` : ''}`;
    setDetail(cell, hourlyDetail(h));
    frag.appendChild(cell);
  });
  strip.appendChild(frag);
  $('hourly-summary').textContent = summarizeHourly(hours);
  syncMetricToggle();
  show('hourly-card');
  // The curve uses raw hourly samples for an on-the-hour resolution.
  renderHourlyGraph(strip, lastHourlyRaw, hourlyMetric, renderId);
}

let hourlyResizeDebounce;
function redrawHourlyGraph() {
  if (!lastHourlyRaw.length || $('hourly-card').hidden) return;
  clearTimeout(hourlyResizeDebounce);
  hourlyResizeDebounce = setTimeout(() => {
    renderHourlyGraph($('hourly-strip'), lastHourlyRaw, hourlyMetric, ++hourlyRenderId);
  }, 80);
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

function renderDaily(daily, hourly) {
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const frag = document.createDocumentFragment();
  $('daily-summary').textContent = summarizeDaily(daily);
  daily.time.forEach((iso, i) => {
    const code = dailyDisplayCode(daily.weather_code[i], hourly, iso);
    const d = describeForecastIcon(code, 1, daily.precipitation_probability_max[i]);
    const bar = rangeBar(daily.temperature_2m_min[i],
                         daily.temperature_2m_max[i], weekMin, weekMax);
    const precip = daily.precipitation_probability_max[i];
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="d-name">${i === 0 ? 'Today' : formatWeekday(iso)}</span>
      ${weatherIconHtml(d.icon)}
      <span class="d-precip">${precip > 0 ? precip + '%' : ''}</span>
      <span class="day-range">
        <span class="range-lo">${Math.round(daily.temperature_2m_min[i])}°</span>
        <span class="range"><span class="range-fill"
          style="left:${bar.left}%;width:${bar.width}%"></span></span>
        <span class="range-hi">${Math.round(daily.temperature_2m_max[i])}°</span>
      </span>`;
    setDetail(row, dailyDetail(daily, i, hourly));
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
  $('t-uv').textContent = formatUv(firstHour ? firstHour.uv : daily.uv_index_max[0]);
  $('t-sunrise').textContent = formatClock(daily.sunrise[0]);
  $('t-sunset').textContent = formatClock(daily.sunset[0]);
  $('t-pressure').textContent = `${Math.round(cur.surface_pressure)} hPa`;
  $('t-visibility').textContent = firstHour
    ? `${u.distanceFrom(firstHour.visibility)} ${u.distanceLabel}` : '—';
  setDetail($('t-wind').closest('.tile'),
    `Wind speed is ${Math.round(cur.wind_speed_10m)} ${u.windLabel}, blowing ${degToCompass(cur.wind_direction_10m)}.`);
  setDetail($('t-humidity').closest('.tile'),
    `Relative humidity is ${cur.relative_humidity_2m}%; higher values make warm air feel heavier.`);
  setDetail($('t-uv').closest('.tile'),
    `UV index is ${formatUv(firstHour ? firstHour.uv : daily.uv_index_max[0])}; stronger sun exposure needs more protection.`);
  setDetail($('t-sunrise').closest('.tile'), `Sunrise today is ${formatClock(daily.sunrise[0])}.`);
  setDetail($('t-sunset').closest('.tile'), `Sunset today is ${formatClock(daily.sunset[0])}.`);
  setDetail($('t-pressure').closest('.tile'),
    `Surface pressure is ${Math.round(cur.surface_pressure)} hPa; falling pressure often points to unsettled weather.`);
  setDetail($('t-visibility').closest('.tile'),
    firstHour ? `Visibility is about ${u.distanceFrom(firstHour.visibility)} ${u.distanceLabel}.` : 'Visibility data is unavailable.');
  show('tiles-card');
}

function setUpdated(date) {
  $('updated-time').textContent = date ? formatUpdated(date) : '';
  $('refresh-btn').hidden = false;
}

let detailTarget = null;
function positionDetailTooltip(target) {
  const tip = $('detail-tooltip');
  const rect = target.getBoundingClientRect();
  const pad = 8;
  const tipWidth = tip.offsetWidth;
  const tipHeight = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - tipWidth / 2;
  let top = rect.top - tipHeight - pad;

  left = Math.max(pad, Math.min(window.innerWidth - tipWidth - pad, left));
  if (top < pad) top = rect.bottom + pad;
  top = Math.max(pad, Math.min(window.innerHeight - tipHeight - pad, top));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showDetailTooltip(target) {
  if (!target?.dataset.detail) return;
  detailTarget = target;
  const tip = $('detail-tooltip');
  tip.textContent = target.dataset.detail;
  tip.hidden = false;
  requestAnimationFrame(() => {
    if (detailTarget === target) positionDetailTooltip(target);
  });
}

function hideDetailTooltip(target) {
  if (target && detailTarget !== target) return;
  detailTarget = null;
  $('detail-tooltip').hidden = true;
}

function renderAll(data, name, updatedAt) {
  lastUpdatedAt = updatedAt || lastUpdatedAt;
  const hours = sliceNext24(data.hourly, data.current.time);
  lastHourlyRaw = hours;            // raw samples power the on-the-hour graph
  lastHours = groupHours(hours, 3); // 3-hour blocks for the strip cells
  renderHero(data.current, data.daily, name);
  renderHourly(lastHours);
  renderDaily(data.daily, data.hourly);
  renderTiles(data.current, data.daily, hours[0]); // raw current hour for tiles
  $('empty').hidden = true;
  showStatus('');
  setUpdated(lastUpdatedAt);
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
  if (!location_) {
    $('hero').hidden = true;
    $('hero-shell').hidden = true;
    $('empty').hidden = false;
    return;
  }
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

async function isLocationBlockedForSite() {
  if (!navigator.permissions?.query) return false;
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    return permission.state === 'denied';
  } catch {
    return false;
  }
}

function useMyLocation() {
  if (!navigator.geolocation) { showStatus('Geolocation unavailable.', true); return; }
  showStatus('Locating…');

  isLocationBlockedForSite().then((blocked) => {
    if (blocked) {
      showStatus('Location is blocked for this site — allow it in browser permissions, or search instead.', false);
      return;
    }

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
      // 1 = permission denied, 2 = unavailable, 3 = timeout
      const map = {
        1: ['Location is blocked for this site — allow it in browser permissions, or search instead.', false],
        2: ['Location unavailable — search a city instead.', true],
        3: ['Location request timed out — try again.', true],
      };
      const [msg, isErr] = map[err.code] || ['Could not get your location — search instead.', true];
      showStatus(msg, isErr);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
  });
}

function toggleUnit() {
  unit = unit === 'fahrenheit' ? 'celsius' : 'fahrenheit';
  localStorage.setItem(LS_UNIT, unit);
  setUnitLabel();
  refresh();
}

function setIconSet(next) {
  if (!ICON_SETS.has(next)) return;
  iconSet = next;
  localStorage.setItem(LS_ICON_SET, iconSet);
  setIconSetControl();
  closeIconSetMenu();
  if (lastData && location_) renderAll(lastData, location_.name, lastUpdatedAt);
}

function openIconSetMenu() {
  $('icon-set-menu').hidden = false;
  $('icon-set-btn').setAttribute('aria-expanded', 'true');
}

function closeIconSetMenu() {
  $('icon-set-menu').hidden = true;
  $('icon-set-btn').setAttribute('aria-expanded', 'false');
}

function toggleIconSetMenu() {
  if ($('icon-set-menu').hidden) openIconSetMenu();
  else closeIconSetMenu();
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
$('icon-set-btn').addEventListener('click', toggleIconSetMenu);
$('icon-set-menu').addEventListener('click', (e) => {
  const option = e.target.closest('[data-icon-set]');
  if (option) setIconSet(option.dataset.iconSet);
});
$('icon-set-btn').addEventListener('keydown', (e) => {
  if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
    e.preventDefault();
    openIconSetMenu();
    $('icon-set-menu').querySelector('.active')?.focus();
  }
});
$('icon-set-menu').addEventListener('keydown', (e) => {
  const options = [...$('icon-set-menu').querySelectorAll('[data-icon-set]')];
  const current = options.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    closeIconSetMenu();
    $('icon-set-btn').focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    options[(current + 1) % options.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    options[(current - 1 + options.length) % options.length].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (document.activeElement?.dataset.iconSet) setIconSet(document.activeElement.dataset.iconSet);
  }
});
$('unit-btn').addEventListener('click', toggleUnit);
$('refresh-btn').addEventListener('click', () => refresh());
$('metric-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setMetric(btn.dataset.metric);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) closeResults();
  if (!e.target.closest('.icon-set-control')) closeIconSetMenu();
});
document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-detail]');
  if (target) showDetailTooltip(target);
});
document.addEventListener('mousemove', () => {
  if (detailTarget && !$('detail-tooltip').hidden) positionDetailTooltip(detailTarget);
});
document.addEventListener('mouseout', (e) => {
  const target = e.target.closest('[data-detail]');
  if (target && !target.contains(e.relatedTarget)) hideDetailTooltip(target);
});
document.addEventListener('focusin', (e) => {
  const target = e.target.closest('[data-detail]');
  if (target) showDetailTooltip(target);
});
document.addEventListener('focusout', (e) => {
  const target = e.target.closest('[data-detail]');
  if (target) hideDetailTooltip(target);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
window.addEventListener('resize', () => {
  redrawHourlyGraph();
  if (detailTarget) positionDetailTooltip(detailTarget);
});

// A location in the URL (a bookmark/shared link) wins over the saved one.
location_ = parseLocationParams(window.location.search) || location_;
if (location_) {
  localStorage.setItem(LS_LOC, JSON.stringify(location_));
  syncUrl(location_); // normalize bare/saved visits into a shareable URL
}

setUnitLabel();
setIconSetControl();
syncMetricToggle();
hydrateFromCache();
refresh();
refreshTimer = setInterval(refresh, 15 * 60 * 1000);

// ---- Service worker (offline app shell) ----
const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if ('serviceWorker' in navigator && !isLocalPreview) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
  });
} else if ('serviceWorker' in navigator && isLocalPreview) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
    .catch(() => { /* local preview should not keep stale SW state around */ });
}
