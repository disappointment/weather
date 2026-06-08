import {
  describeWeather, comfortFace, sliceNext24, sliceDayHours, groupHours, degToCompass, unitConfig,
  rangeBar, forecastUrl, FORECAST_MODELS, geocodeUrl, reverseGeocodeUrl, parsePlaces,
  parseLocationParams, locationQuery,
  airQualityUrl, parseAirQuality, aqiCategory, pollenSummary,
  goldenHour, moonPhase, daylightProgress,
  parseMinutely, nowcastText,
} from './weather.js';

/** @typedef {import('./weather.js').Place} Place */
/** @typedef {import('./weather.js').TemperatureUnit} TemperatureUnit */
/** @typedef {import('./weather.js').HourlyData} HourlyData */
/** @typedef {import('./weather.js').HourSample} HourSample */
/** @typedef {import('./weather.js').HourBlock} HourBlock */
/** @typedef {import('./weather.js').AirQuality} AirQuality */

/**
 * Open-Meteo `current` block (only the fields this app reads).
 * @typedef {object} CurrentData
 * @property {string} time
 * @property {number} temperature_2m
 * @property {number} relative_humidity_2m
 * @property {number} apparent_temperature
 * @property {number} is_day
 * @property {number} precipitation
 * @property {number} weather_code
 * @property {number} wind_speed_10m
 * @property {number} wind_direction_10m
 * @property {number} surface_pressure
 */

/**
 * Open-Meteo `daily` block: parallel arrays indexed by day.
 * @typedef {object} DailyData
 * @property {string[]} time
 * @property {number[]} weather_code
 * @property {number[]} temperature_2m_max
 * @property {number[]} temperature_2m_min
 * @property {number[]} precipitation_probability_max
 * @property {string[]} sunrise
 * @property {string[]} sunset
 * @property {number[]} uv_index_max
 */

/**
 * Full Open-Meteo forecast response (the slices this app reads).
 * @typedef {object} ForecastData
 * @property {CurrentData} current
 * @property {HourlyData} hourly
 * @property {DailyData} daily
 */

/**
 * Fields the metric accessors read. Covers both raw hourly samples (graph) and
 * grouped blocks (strip cells); every field is optional since blocks omit some.
 * @typedef {object} MetricSample
 * @property {number} [temp]
 * @property {number} [precip]
 * @property {number} [wind]
 * @property {number} [humidity]
 * @property {number} [uv]
 * @property {number} [feels]
 */

/**
 * One hourly-graph metric descriptor. Accessors run over both the raw hourly
 * samples (graph) and the grouped blocks (strip cells).
 * @typedef {object} Metric
 * @property {string} label
 * @property {(h: MetricSample) => number|undefined} value
 * @property {(v: number|undefined) => string} cell
 * @property {(v: number) => string} axis
 * @property {() => import('./weather.js').GraphDomain} domain
 * @property {(h: MetricSample) => string} [sub]
 */

// Elements are static in index.html, so treat lookups as non-null at call sites;
// genuine nullables (querySelector, event targets, storage) stay guarded.
/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
// DOM events here always originate from elements; narrow target for .closest/etc.
/** @param {Event} e */
const evtEl = (e) => /** @type {HTMLElement} */ (e.target);
const LS_LOC = 'weather.location';
const LS_UNIT = 'weather.unit';
const LS_DATA = 'weather.lastData';
const LS_METRIC = 'weather.metric';
const LS_RESOLUTION = 'weather.resolution';
const LS_ICON_SET = 'weather.iconSet';
const LS_SAVED = 'weather.saved';
const LS_SCHEME = 'weather.scheme';
const LS_MODEL = 'weather.model';

/** @type {import('./weather.js').TemperatureUnit} */
let unit = localStorage.getItem(LS_UNIT) === 'celsius' ? 'celsius' : 'fahrenheit';
let iconSet = localStorage.getItem(LS_ICON_SET) || 'illustrated';
// The old unicode "line" set was replaced by the Lucide SVG set under a new key.
if (iconSet === 'line') iconSet = 'lucide';
// Retired sets fall back to the default so a stale preference doesn't dead-end.
if (iconSet === 'phosphor' || iconSet === 'mono') iconSet = 'illustrated';
const MODEL_VALUES = new Set(FORECAST_MODELS.map((m) => m.value));
const storedModel = localStorage.getItem(LS_MODEL);
let model = storedModel && MODEL_VALUES.has(storedModel) ? storedModel : 'best_match';
const SCHEMES = ['auto', 'light', 'dark'];
const storedScheme = localStorage.getItem(LS_SCHEME) || 'auto';
let scheme = SCHEMES.includes(storedScheme) ? storedScheme : 'auto';
/** @type {Place | null} */
let location_ = loadJSON(LS_LOC); // { name, lat, lon } | null
/** @type {ForecastData | null} */
let lastData = null;
/** @type {Date | null} */
let lastUpdatedAt = null;
/** @type {HourBlock[]} */
let lastHours = [];               // 3-hour blocks, kept for cell re-renders
/** @type {HourSample[]} */
let lastHourlyRaw = [];           // raw hourly samples, kept for the graph curve
let hourlyMetric = localStorage.getItem(LS_METRIC) || 'temp';
// Block size for the hourly strip: 1 (hourly), 3 (default), or 6 (6-hourly).
const HOURLY_RESOLUTIONS = [1, 3, 6];
let hourlyResolution = (() => {
  const stored = Number(localStorage.getItem(LS_RESOLUTION));
  return HOURLY_RESOLUTIONS.includes(stored) ? stored : 3;
})();
/** @type {ReturnType<typeof setInterval> | null} */
let refreshTimer = null;
/** @type {AbortController | null} */
let forecastController = null; // aborts in-flight forecast fetches
/** @type {AbortController | null} */
let airController = null;       // aborts in-flight air-quality fetches
/** @type {AbortController | null} */
let searchController = null;    // aborts in-flight search fetches
let hourlyRenderId = 0;

// Search/combobox state
/** @type {Place[]} */
let currentPlaces = [];
let activeIndex = -1;

// Saved locations (chips) + tap-a-day state
/** @type {Place[]} */
let saved = loadJSON(LS_SAVED) || []; // [{ name, lat, lon }]
/** @type {string | null} */
let selectedDayIso = null;            // ISO date of the day shown in the hourly graph, or null for next-24h
/** @type {HourSample[]} */
let defaultDayHours = [];             // the original next-24h raw hours, for "Back"
/** @type {number | null} */
let draggedSavedIndex = null;
let suppressSavedClick = false;
/** @type {{ chip: HTMLElement, fromIndex: number, startX: number, startY: number, pointerId: number, dragging: boolean } | null} */
let savedDrag = null;

/** @param {string} key */
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); }
  catch { return null; }
}

function setUnitLabel() {
  $('unit-btn').textContent = unit === 'fahrenheit' ? '°F' : '°C';
}

function setIconSetControl() {
  const active = ICON_SETS.has(iconSet) ? iconSet : 'illustrated';
  $('icon-set-label').textContent = /** @type {Record<string, string>} */ (ICON_SET_LABELS)[active];
  $('icon-set-btn-icon').innerHTML = weatherIconHtml('sun', 'icon-set-preview-icon', active);
  freezeIconMotion($('icon-set-btn-icon'));
  /** @type {NodeListOf<HTMLElement>} */ ($('icon-set-menu').querySelectorAll('[role="option"]')).forEach((option) => {
    const selected = option.dataset.iconSet === active;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    option.classList.toggle('active', selected);
  });
}

// Fill each menu option with a small sun glyph rendered in *its own* set, so the
// list previews what you're choosing. Runs once — the previews never change.
function renderIconSetPreviews() {
  /** @type {NodeListOf<HTMLElement>} */ ($('icon-set-menu').querySelectorAll('[role="option"]')).forEach((option) => {
    const slot = option.querySelector('.icon-set-preview');
    if (slot && option.dataset.iconSet) {
      slot.innerHTML = weatherIconHtml('sun', 'icon-set-preview-icon', option.dataset.iconSet);
    }
  });
  freezeIconMotion($('icon-set-menu'));
}

// The model menu is data-driven from FORECAST_MODELS so the list lives in one
// place (weather.js, where forecastUrl validates against it).
function populateModelMenu() {
  const frag = document.createDocumentFragment();
  FORECAST_MODELS.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    btn.dataset.model = m.value;
    btn.textContent = m.label;
    frag.appendChild(btn);
  });
  $('model-menu').replaceChildren(frag);
}

function setModelControl() {
  const active = MODEL_VALUES.has(model) ? model : 'best_match';
  $('model-label').textContent = FORECAST_MODELS.find((m) => m.value === active)?.label || 'Best match';
  /** @type {NodeListOf<HTMLElement>} */ ($('model-menu').querySelectorAll('[role="option"]')).forEach((option) => {
    const selected = option.dataset.model === active;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    option.classList.toggle('active', selected);
  });
}

/**
 * @param {string} msg
 * @param {boolean} [isError]
 */
function showStatus(msg, isError = false) {
  const el = $('status');
  // Errors interrupt; routine status is announced politely.
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = !msg;
}

/** @param {string} theme */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ---- Color scheme (light/dark/auto) ----
// data-scheme is independent of data-theme (the weather condition): dark mode
// layers on top of whatever condition theme is active.
const SCHEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const SCHEME_GLYPHS = { auto: '◐', light: '☀', dark: '☾' };
const darkMql = window.matchMedia('(prefers-color-scheme: dark)');

// Resolve auto against the OS preference; dark/light are explicit.
function isDarkScheme() {
  return scheme === 'dark' || (scheme === 'auto' && darkMql.matches);
}

function applyScheme() {
  const root = document.documentElement;
  if (isDarkScheme()) root.setAttribute('data-scheme', 'dark');
  else root.setAttribute('data-scheme', 'light');
}

function setSchemeControl() {
  const btn = $('scheme-btn');
  if (!btn) return;
  /** @type {HTMLElement} */ (btn.querySelector('.scheme-glyph')).textContent = /** @type {Record<string, string>} */ (SCHEME_GLYPHS)[scheme];
  const label = `Theme: ${/** @type {Record<string, string>} */ (SCHEME_LABELS)[scheme]}`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function cycleScheme() {
  scheme = SCHEMES[(SCHEMES.indexOf(scheme) + 1) % SCHEMES.length];
  localStorage.setItem(LS_SCHEME, scheme);
  setSchemeControl();
  applyScheme();
}

// React to OS dark-mode changes, but only when we're following it (auto).
darkMql.addEventListener('change', () => {
  if (scheme === 'auto') applyScheme();
});

/** @param {string} name */
const ICON_SETS = new Set([
  'illustrated', 'meteo', 'meteoline', 'emoji', 'vivid', 'lucide', 'tabler', 'wi',
]);
// SVG icon sets resolve to sprite symbols by id prefix. Each set keeps its source
// viewBox; monochrome sets reuse the mono treatment (themed currentColor, no shadow).
const SVG_SETS = {
  illustrated: { prefix: 'icon-', box: '0 0 24 24', cls: '' },
  meteo: { prefix: 'icon-meteo-', box: '0 0 64 64', cls: '' },
  meteoline: { prefix: 'icon-meteoline-', box: '0 0 64 64', cls: '' },
  lucide: { prefix: 'icon-lucide-', box: '0 0 24 24', cls: ' weather-icon-mono' },
  tabler: { prefix: 'icon-tabler-', box: '0 0 24 24', cls: ' weather-icon-mono' },
  wi: { prefix: 'icon-wi-', box: '0 0 30 30', cls: ' weather-icon-mono' },
};
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
const ICON_SET_LABELS = {
  illustrated: 'Illustrated',
  meteo: 'Meteocons',
  meteoline: 'Meteocons Line',
  emoji: 'Emoji',
  vivid: 'Vivid',
  lucide: 'Lucide',
  tabler: 'Tabler',
  wi: 'Weather Icons',
};

/**
 * @param {string} name
 * @param {string} [className]
 * @param {string} [set] icon set to render; defaults to the active one
 */
function weatherIconHtml(name, className = 'weather-icon', set = iconSet) {
  /**
   * @param {string} inner
   * @param {string} [extra]
   */
  const wrap = (inner, extra = '') => `<span class="${className} weather-icon-box${extra}" data-icon="${name}" aria-hidden="true">${inner}</span>`;
  if (set === 'emoji') {
    return wrap(`<span class="weather-emoji">${/** @type {Record<string, string>} */ (EMOJI_ICON)[name] || '☁️'}</span>`);
  }
  if (set === 'vivid') {
    return wrap(`<span class="weather-emoji">${/** @type {Record<string, string>} */ (VIVID_ICON)[name] || '☁️'}</span>`);
  }
  const svg = /** @type {Record<string, {prefix: string, box: string, cls: string}>} */ (SVG_SETS)[set]
    || SVG_SETS.illustrated;
  return wrap(`<svg viewBox="${svg.box}"><use href="#${svg.prefix}${name}"></use></svg>`, svg.cls);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// The Meteocons set animates via SVG SMIL, which CSS prefers-reduced-motion can't
// touch. Freeze each rendered icon's animation timeline at its first frame instead.
/** @param {ParentNode} [root] */
function freezeIconMotion(root = document) {
  if (!reducedMotion.matches) return;
  root.querySelectorAll('.weather-icon-box > svg').forEach((svg) => {
    /** @type {SVGSVGElement} */ (svg).pauseAnimations?.();
  });
}

/** @param {string} iso */
function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}
/** @param {string} iso */
function formatHourLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric' });
}
/** @param {string} iso */
function formatWeekday(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}
/**
 * @param {string} iso
 * @param {number} i
 */
function formatDayLabel(iso, i) {
  return i === 0 ? 'today' : formatWeekday(iso);
}
/** @param {string} s */
function sentenceCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
/** @param {Date} date */
function formatUpdated(date) {
  return 'Updated ' + date.toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}
/**
 * @param {number|undefined} v
 * @param {string} [suffix]
 */
function formatValue(v, suffix = '') {
  return Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))}${suffix}` : '—';
}
/** @param {number|undefined} v */
function uvCategory(v) {
  if (!Number.isFinite(v) || v === undefined) return 'Unknown';
  if (v < 3) return 'Low';
  if (v < 6) return 'Moderate';
  if (v < 8) return 'High';
  if (v < 11) return 'Very high';
  return 'Extreme';
}
/** @param {number|undefined} v */
function formatUv(v) {
  return Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))} (${uvCategory(v)})` : '—';
}

// ---- Rendering ----

// A tile value with a smaller secondary line beneath the headline. Inputs are
// app-generated (numbers, category labels, formatted times) — never user text.
/**
 * @param {string} primary
 * @param {string} sub
 * @returns {string}
 */
function tileValueHtml(primary, sub) {
  return `${primary}<span class="tile-sub">${sub}</span>`;
}

/** @param {string} id */
function show(id) { $(id).hidden = false; }

/**
 * @param {HTMLElement | null} el
 * @param {string} text
 */
function setDetail(el, text) {
  if (!el) return;
  el.dataset.detail = text;
  el.title = text;
  el.classList.add('detail-target');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
}

/**
 * @param {CurrentData} cur
 * @param {DailyData} daily
 * @param {string} name
 */
function renderHero(cur, daily, name) {
  const d = describeWeather(cur.weather_code, cur.is_day);
  const u = unitConfig(unit);
  setTheme(d.theme);
  show('hero-shell');
  $('place-name').textContent = name;
  $('hero-temp').textContent = String(Math.round(cur.temperature_2m));
  $('hero-icon-slot').innerHTML = weatherIconHtml(d.icon, 'hero-icon weather-icon');
  $('hero-condition').textContent = d.label;
  $('hero-feels').textContent = `Feels ${Math.round(cur.apparent_temperature)}°`;
  // Band the same rounded value the user sees, so "Feels 88°" never sits
  // next to a face the 88° boundary contradicts.
  const comfort = comfortFace(Math.round(cur.apparent_temperature), unit);
  renderComfortFace(comfort);
  $('hero-hi').textContent = `H ${Math.round(daily.temperature_2m_max[0])}°`;
  $('hero-lo').textContent = `L ${Math.round(daily.temperature_2m_min[0])}°`;
  setDetail($('hero-shell'),
    `${name}: ${d.label}, ${Math.round(cur.temperature_2m)}° and feels like ${Math.round(cur.apparent_temperature)}°` +
    `${comfort ? ` (${comfort.label})` : ''}. ` +
    `High ${Math.round(daily.temperature_2m_max[0])}°, low ${Math.round(daily.temperature_2m_min[0])}°. ` +
    `Wind ${Math.round(cur.wind_speed_10m)} ${u.windLabel} ${degToCompass(cur.wind_direction_10m)}; humidity ${cur.relative_humidity_2m}%.`);
  renderDaylight(cur, daily);
  show('hero');
}

// Comfort emoji beside "Feels X°": a quick mood read on the feels-like temp.
// Hidden entirely when apparent temp is missing (comfortFace returns null).
/** @param {{ emoji: string, label: string } | null} comfort */
function renderComfortFace(comfort) {
  const el = $('hero-comfort');
  if (!el) return;
  if (!comfort) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = comfort.emoji;
  el.setAttribute('aria-label', comfort.label);
  el.title = comfort.label;
  el.hidden = false;
}

// Sunrise→sunset progress bar in the hero footer: the fill and marker track the
// current time within the daylight window.
/**
 * @param {CurrentData} cur
 * @param {DailyData} daily
 */
function renderDaylight(cur, daily) {
  const el = $('daylight');
  const rise = daily.sunrise[0];
  const set = daily.sunset[0];
  if (!rise || !set) { el.hidden = true; return; }
  const dl = daylightProgress(rise, set, cur.time);
  const pct = `${(dl.fraction * 100).toFixed(1)}%`;
  $('daylight-rise').textContent = formatClock(rise);
  $('daylight-set').textContent = formatClock(set);
  $('daylight-fill').style.width = pct;
  $('daylight-dot').style.left = pct;
  el.classList.toggle('is-night', !dl.isDaytime);
  el.hidden = false;
}

const GRAPH_H = 84;
const GRAPH_PAD = 10;

// Hourly graph metrics (Google-style toggle). Each maps an hour to a value,
// formats the per-cell label, and pins the graph's y-domain where it matters.
/** @type {Record<string, Metric>} */
const METRICS = {
  temp: {
    label: 'Temp',
    value: (h) => h.temp,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))}°` : '—'),
    // Secondary per-cell readout shown under the temp (temp view only).
    sub: (h) => (Number.isFinite(h.humidity) ? `${Math.round(/** @type {number} */ (h.humidity))}%` : '—'),
    axis: (v) => `${Math.round(v)}°`,
    domain: () => ({}), // auto min/max — temperature is about the shape
  },
  precip: {
    label: 'Precip',
    value: (h) => h.precip,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))}%` : '—'),
    axis: (v) => `${Math.round(v)}%`,
    domain: () => ({ min: 0, max: 100 }), // probability is absolute 0–100
  },
  wind: {
    label: 'Wind',
    value: (h) => h.wind,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))} ${unitConfig(unit).windLabel}` : '—'),
    axis: (v) => `${Math.round(v)} ${unitConfig(unit).windLabel}`,
    domain: () => ({ min: 0 }), // baseline at calm
  },
  humidity: {
    label: 'Humidity',
    value: (h) => h.humidity,
    cell: (v) => (Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))}%` : '—'),
    axis: (v) => `${Math.round(v)}%`,
    domain: () => ({ min: 0, max: 100 }), // relative humidity is absolute 0–100
  },
  uv: {
    label: 'UV',
    value: (h) => h.uv,
    cell: (v) => (Number.isFinite(v) ? String(Math.round(/** @type {number} */ (v))) : '—'),
    axis: (v) => String(Math.round(v)),
    domain: () => ({ min: 0 }), // baseline at no exposure
  },
};

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => number|undefined} getValue
 * @returns {{ item: T, index: number, value: number } | null}
 */
function maxBy(items, getValue) {
  return items.reduce(
    /**
     * @param {{ item: T, index: number, value: number } | null} best
     * @param {T} item
     * @param {number} index
     */
    (best, item, index) => {
      const value = Number(getValue(item, index));
      if (!Number.isFinite(value)) return best;
      return !best || value > best.value ? { item, index, value } : best;
    },
    /** @type {{ item: T, index: number, value: number } | null} */ (null),
  );
}

/** @param {HourBlock[]} hours */
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

/** @param {DailyData} daily */
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

/**
 * @param {HourlyData} hourly
 * @param {string} dateIso
 */
function daylightCodesForDate(hourly, dateIso) {
  if (!hourly?.time) return [];
  /** @type {number[]} */
  const codes = [];
  hourly.time.forEach((time, i) => {
    if (!time.startsWith(dateIso) || !Number(hourly.is_day?.[i])) return;
    const code = hourly.weather_code?.[i];
    if (Number.isFinite(code)) codes.push(code);
  });
  return codes;
}

/**
 * @param {number} dailyCode
 * @param {HourlyData} hourly
 * @param {string} dateIso
 */
function dailyDisplayCode(dailyCode, hourly, dateIso) {
  const codes = daylightCodesForDate(hourly, dateIso);
  if (!codes.length) return dailyCode;

  const hasSunBreaks = codes.some((code) => [0, 1, 2].includes(code));
  const hasClouds = codes.some((code) => [2, 3].includes(code));
  if ([0, 1, 2, 3].includes(dailyCode) && hasSunBreaks && hasClouds) return 2;

  return dailyCode;
}

/** @param {HourSample | HourBlock} h */
function hourlyDetail(h) {
  const d = describeForecastIcon(h.code, h.isDay, h.precip);
  const u = unitConfig(unit);
  return `${formatHourLabel(h.time)}: ${d.label}. ` +
    `Temp ${formatValue(h.temp, '°')}; humidity ${formatValue(h.humidity, '%')}; ` +
    `rain chance ${formatValue(h.precip, '%')}; ` +
    `wind ${Number.isFinite(h.wind) ? `${Math.round(/** @type {number} */ (h.wind))} ${u.windLabel}` : '—'}.`;
}

/**
 * @param {DailyData} daily
 * @param {number} i
 * @param {HourlyData} hourly
 */
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

/**
 * @param {number} code
 * @param {number|string|boolean} isDay
 * @param {number|undefined} precip
 */
function describeForecastIcon(code, isDay, precip) {
  const d = describeWeather(code, isDay);
  if (Number.isFinite(precip) && /** @type {number} */ (precip) >= 35 && !['rain', 'snow', 'thunder'].includes(d.icon)) {
    return { ...d, icon: 'rain', label: /** @type {number} */ (precip) >= 60 ? 'Rain likely' : 'Rain possible' };
  }
  return d;
}

/** @param {import('./weather.js').Point[]} points */
function pathFromPoints(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// xOf maps an hourly index to its pixel x. The curve carries a point per hour;
// labelEvery keeps the per-point value text at the cell cadence (every 3rd).
/**
 * @param {HourSample[]} hours
 * @param {string} metric
 * @param {number} width
 * @param {(i: number) => number} xOf
 * @param {number} [labelEvery]
 */
function metricGraphSvg(hours, metric, width, xOf, labelEvery = 3) {
  const m = METRICS[metric] || METRICS.temp;
  const valid = hours
    .map((h, i) => ({ value: Number(m.value(h)), x: xOf(i), index: i }))
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.x));
  if (valid.length < 2 || !Number.isFinite(width) || width <= 0) return '';

  const domain = m.domain();
  let min = Number.isFinite(domain.min) ? /** @type {number} */ (domain.min) : Math.min(...valid.map((p) => p.value));
  let max = Number.isFinite(domain.max) ? /** @type {number} */ (domain.max) : Math.max(...valid.map((p) => p.value));
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const drawable = GRAPH_H - GRAPH_PAD * 2;
  /** @param {number} value */
  const yOf = (value) => {
    const clamped = Math.max(min, Math.min(max, value));
    return GRAPH_PAD + ((max - clamped) / (max - min)) * drawable;
  };
  const points = valid.map((p) => ({ x: p.x, y: yOf(p.value), value: p.value, index: p.index }));
  const line = pathFromPoints(points);

  // Night shading: shade contiguous spans where the raw hour's isDay is falsy,
  // behind the area. Half-step out on each side so a span hugs its hour cells.
  /** @type {string[]} */
  const nightRects = [];
  let runStart = -1;
  /** @param {number} end */
  const flushRun = (end) => {
    if (runStart < 0) return;
    const x1 = Math.max(0, Math.min(width, xOf(runStart - 0.5)));
    const x2 = Math.max(0, Math.min(width, xOf(end + 0.5)));
    if (x2 > x1) {
      nightRects.push(`<rect class="graph-night" x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${GRAPH_H}"/>`);
    }
    runStart = -1;
  };
  hours.forEach((h, i) => {
    if (!Number(h.isDay)) {
      if (runStart < 0) runStart = i;
    } else {
      flushRun(i - 1);
    }
  });
  flushRun(hours.length - 1);
  const night = nightRects.join('');

  // Feels-like ghost line (temp view only): a second faint curve through each
  // raw hour's apparent temperature, mapped with the same y-scale as temp.
  let ghost = '';
  if (metric === 'temp') {
    const ghostPoints = hours
      .map((h, i) => ({ value: Number(h.feels), x: xOf(i) }))
      .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.x))
      .map((p) => ({ x: p.x, y: yOf(p.value) }));
    if (ghostPoints.length >= 2) {
      ghost = `<path class="graph-line-ghost" d="${pathFromPoints(ghostPoints)}"/>`;
    }
  }
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
      <g class="graph-nights">${night}</g>
      <g class="graph-axis">
        <line x1="0" y1="${topY}" x2="${width}" y2="${topY}"/>
        <line x1="0" y1="${bottomY}" x2="${width}" y2="${bottomY}"/>
        <text x="${labelX}" y="${topY + 3}" text-anchor="start">${topLabel}</text>
        <text x="${labelX}" y="${bottomY + 3}" text-anchor="start">${bottomLabel}</text>
      </g>
      <path class="graph-area" d="${area}"/>
      ${ghost}
      <path class="graph-line" d="${line}"/>
      <g class="graph-values">${valueLabels}</g>
      <g class="graph-dots">${dots}</g>
    </svg>`;
}

// hours here are the raw hourly samples. Cells sit every `hourlyResolution` hours,
// so we read their centers and interpolate a per-hour pitch to place a dot on each hour.
/**
 * @param {HTMLElement} strip
 * @param {HourSample[]} hours
 * @param {string} metric
 * @param {number} renderId
 */
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
    const pitch = (centers[1] - centers[0]) / hourlyResolution; // px per hour
    /** @param {number} i */
    const xOf = (i) => centers[0] + i * pitch;
    // Keep the curve within the cells' span so the SVG never widens the
    // scroll area. scrollWidth here is the cells-only extent (graph not yet in).
    const maxIndex = (cells.length - 1) * hourlyResolution;
    const series = hours.slice(0, maxIndex + 1);
    const contentWidth = Math.max(strip.clientWidth, strip.scrollWidth);
    strip.insertAdjacentHTML('afterbegin', metricGraphSvg(series, metric, contentWidth, xOf));
  });
}

/** @param {HourBlock[]} hours */
function renderHourly(hours) {
  const strip = $('hourly-strip');
  const m = METRICS[hourlyMetric] || METRICS.temp;
  const renderId = ++hourlyRenderId;
  strip.textContent = '';
  strip.style.setProperty('--hour-count', String(Math.max(hours.length, 1)));
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
      ${hasSub ? `<div class="h-sub"><svg class="h-sub-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-humidity"></use></svg>${/** @type {NonNullable<Metric['sub']>} */ (m.sub)(h)}</div>` : ''}`;
    setDetail(cell, hourlyDetail(h));
    frag.appendChild(cell);
  });
  strip.appendChild(frag);
  $('hourly-summary').textContent = summarizeHourly(hours);
  syncMetricToggle();
  syncResolutionToggle();
  show('hourly-card');
  // The curve uses raw hourly samples for an on-the-hour resolution.
  renderHourlyGraph(strip, lastHourlyRaw, hourlyMetric, renderId);
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let hourlyResizeDebounce;
function redrawHourlyGraph() {
  if (!lastHourlyRaw.length || $('hourly-card').hidden) return;
  clearTimeout(hourlyResizeDebounce);
  hourlyResizeDebounce = setTimeout(() => {
    renderHourlyGraph($('hourly-strip'), lastHourlyRaw, hourlyMetric, ++hourlyRenderId);
  }, 80);
}

function syncMetricToggle() {
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#metric-toggle .seg-btn')).forEach((btn) => {
    const on = btn.dataset.metric === hourlyMetric;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** @param {string} metric */
function setMetric(metric) {
  if (!METRICS[metric]) return;
  hourlyMetric = metric;
  localStorage.setItem(LS_METRIC, metric);
  if (lastHours.length) renderHourly(lastHours);
  else syncMetricToggle();
}

function syncResolutionToggle() {
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#resolution-toggle .seg-btn')).forEach((btn) => {
    const on = Number(btn.dataset.resolution) === hourlyResolution;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** @param {number} size */
function setResolution(size) {
  if (!HOURLY_RESOLUTIONS.includes(size) || size === hourlyResolution) return;
  hourlyResolution = size;
  localStorage.setItem(LS_RESOLUTION, String(size));
  // Re-block the raw samples for the view currently on screen (next-24 or a day).
  if (lastHourlyRaw.length) {
    lastHours = groupHours(lastHourlyRaw, hourlyResolution);
    renderHourly(lastHours);
  } else {
    syncResolutionToggle();
  }
}

/**
 * @param {DailyData} daily
 * @param {HourlyData} hourly
 */
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
    // Each day is a button so it's keyboard-operable; clicking loads that day
    // into the hourly graph. aria-pressed reflects which day is shown.
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'day-row';
    row.dataset.dayIso = iso;
    // Day 0 (today) selected == the default next-24h view.
    const isSelected = (i === 0 && !selectedDayIso) || selectedDayIso === iso;
    row.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    row.classList.toggle('active', isSelected);
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
    row.addEventListener('click', () => selectDay(iso, i));
    frag.appendChild(row);
  });
  $('daily-list').replaceChildren(frag);
  show('daily-card');
}

/**
 * @param {CurrentData} cur
 * @param {DailyData} daily
 * @param {HourSample | undefined} firstHour
 */
function renderTiles(cur, daily, firstHour) {
  const u = unitConfig(unit);
  $('t-wind').textContent =
    `${Math.round(cur.wind_speed_10m)} ${u.windLabel} ${degToCompass(cur.wind_direction_10m)}`;
  $('t-humidity').textContent = `${cur.relative_humidity_2m}%`;
  const uvVal = firstHour ? firstHour.uv : daily.uv_index_max[0];
  $('t-uv').innerHTML = Number.isFinite(uvVal)
    ? tileValueHtml(String(Math.round(/** @type {number} */ (uvVal))), uvCategory(uvVal))
    : '—';
  $('t-pressure').textContent = `${Math.round(cur.surface_pressure)} hPa`;
  $('t-visibility').textContent = firstHour
    ? `${u.distanceFrom(firstHour.visibility)} ${u.distanceLabel}` : '—';
  setDetail($('t-wind').closest('.tile'),
    `Wind speed is ${Math.round(cur.wind_speed_10m)} ${u.windLabel}, blowing ${degToCompass(cur.wind_direction_10m)}.`);
  setDetail($('t-humidity').closest('.tile'),
    `Relative humidity is ${cur.relative_humidity_2m}%; higher values make warm air feel heavier.`);
  setDetail($('t-uv').closest('.tile'),
    `UV index is ${formatUv(firstHour ? firstHour.uv : daily.uv_index_max[0])}; stronger sun exposure needs more protection.`);

  const golden = goldenHour(daily.sunrise[0], daily.sunset[0]);
  $('t-golden').innerHTML = tileValueHtml(
    formatClock(golden.evening.start), `to ${formatClock(golden.evening.end)}`);
  setDetail($('t-golden').closest('.tile'),
    `Golden hour — soft, warm light for photos. Morning ` +
    `${formatClock(golden.morning.start)}–${formatClock(golden.morning.end)}; ` +
    `evening ${formatClock(golden.evening.start)}–${formatClock(golden.evening.end)}.`);

  const moon = moonPhase(new Date());
  $('t-moon').innerHTML = tileValueHtml(moon.emoji, moon.name);
  setDetail($('t-moon').closest('.tile'),
    `${moon.name}, about ${Math.round(moon.illumination * 100)}% illuminated.`);
  setDetail($('t-pressure').closest('.tile'),
    `Surface pressure is ${Math.round(cur.surface_pressure)} hPa; falling pressure often points to unsettled weather.`);
  setDetail($('t-visibility').closest('.tile'),
    firstHour ? `Visibility is about ${u.distanceFrom(firstHour.visibility)} ${u.distanceLabel}.` : 'Visibility data is unavailable.');
  show('tiles-card');
}

// Air quality lives in its own tile; data arrives from a separate API call, so
// it renders independently of renderTiles (which has only forecast data).
/** @param {AirQuality} aq */
function renderAirQuality(aq) {
  const tile = /** @type {HTMLElement | null} */ ($('t-aqi')?.closest('.tile'));
  if (!tile) return;
  const hasAqi = Number.isFinite(aq.usAqi);
  // Match the UV tile: headline number with the category as a .tile-sub caption.
  $('t-aqi').innerHTML = hasAqi
    ? tileValueHtml(String(Math.round(/** @type {number} */ (aq.usAqi))), aqiCategory(aq.usAqi))
    : '—';
  /**
   * @param {number|undefined} v
   * @param {string} suffix
   */
  const fmt = (v, suffix) => (Number.isFinite(v) ? `${Math.round(/** @type {number} */ (v))}${suffix}` : '—');
  const pollen = pollenSummary(aq);
  setDetail(tile, hasAqi
    ? `US AQI ${Math.round(/** @type {number} */ (aq.usAqi))} (${aqiCategory(aq.usAqi)}). ` +
      `PM2.5 ${fmt(aq.pm25, ' µg/m³')}; PM10 ${fmt(aq.pm10, ' µg/m³')}; ozone ${fmt(aq.ozone, ' µg/m³')}.` +
      (pollen ? ` Pollen — ${pollen}.` : '')
    : 'Air quality data is unavailable.');
  tile.hidden = false;
}

// Precip nowcast from minutely_15: a one-line summary under the hourly summary.
// Hidden when there's nothing to say (no minutely data).
/** @param {any} data */
function renderNowcast(data) {
  const el = $('nowcast');
  if (!el) return;
  const samples = parseMinutely(data);
  const text = samples.length ? nowcastText(samples) : '';
  el.textContent = text;
  el.hidden = !text;
}

/** @param {Date | null} date */
function setUpdated(date) {
  $('updated-time').textContent = date ? formatUpdated(date) : '';
  $('refresh-btn').hidden = false;
}

/** @type {HTMLElement | null} */
let detailTarget = null;
/** @param {HTMLElement} target */
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

/** @param {Element | null} targetEl */
function showDetailTooltip(targetEl) {
  const target = /** @type {HTMLElement | null} */ (targetEl);
  if (!target?.dataset.detail) return;
  detailTarget = target;
  const tip = $('detail-tooltip');
  tip.textContent = target.dataset.detail;
  tip.hidden = false;
  requestAnimationFrame(() => {
    if (detailTarget === target) positionDetailTooltip(target);
  });
}

/** @param {Element | null} targetEl */
function hideDetailTooltip(targetEl) {
  const target = /** @type {HTMLElement | null} */ (targetEl);
  if (target && detailTarget !== target) return;
  detailTarget = null;
  $('detail-tooltip').hidden = true;
}

// Reveal + refresh the radar card. Lazy: the Leaflet map is created on first
// reveal (via initRadar inside updateRadar), so it never blocks initial render.
// Radar is online-only and self-guards, so any failure stays contained here.
/** @param {Place | null} loc */
function showRadar(loc) {
  if (!loc) return;
  const card = $('radar-card');
  if (!card) return;
  // Defer map creation to the next frame so the card has layout (Leaflet needs
  // a sized container) before we build tiles. Radar is dynamically imported so
  // a bad deployed /radar.js MIME type cannot break the main weather app.
  requestAnimationFrame(() => {
    import('./radar.js')
      .then(({ updateRadar }) => {
        card.hidden = false;
        return updateRadar(loc);
      })
      .catch(() => {
        card.hidden = true;
      });
  });
}

/**
 * @param {ForecastData} data
 * @param {string} name
 * @param {Date | null} [updatedAt]
 */
function renderAll(data, name, updatedAt) {
  lastUpdatedAt = updatedAt || lastUpdatedAt;
  const hours = sliceNext24(data.hourly, data.current.time);
  defaultDayHours = hours;          // remembered so "Back" restores the next-24h view exactly
  selectedDayIso = null;            // a fresh render resets to the default next-24h view
  lastHourlyRaw = hours;            // raw samples power the on-the-hour graph
  lastHours = groupHours(hours, hourlyResolution); // blocks for the strip cells
  renderHero(data.current, data.daily, name);
  renderHourly(lastHours);
  renderDaily(data.daily, data.hourly);
  syncDayNote();                    // hide the day-note / reflect "today" selection
  renderTiles(data.current, data.daily, hours[0]); // raw current hour for tiles
  renderNowcast(data);              // minutely_15 precip rides the forecast call
  $('empty').hidden = true;
  showStatus('');
  setUpdated(lastUpdatedAt);
  showRadar(location_);             // lazy radar reveal/center (online-only, self-guarded)
  freezeIconMotion();               // honor prefers-reduced-motion for animated (Meteocons) icons
}

// ---- Data flow ----

/**
 * @param {Place | null | undefined} a
 * @param {Place | null | undefined} b
 */
function sameLoc(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
}

/** @param {ForecastData} data */
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
    const res = await fetch(forecastUrl(location_.lat, location_.lon, unit, model), { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastData = data;
    persist(data);
    renderAll(data, location_.name, new Date());
  } catch (err) {
    const e = /** @type {Error} */ (err);
    if (e.name === 'AbortError') return; // superseded by a newer request
    showStatus(lastData
      ? 'Could not refresh — showing last data.'
      : `Could not load weather (${e.message}).`, true);
  }
  refreshAirQuality();
}

// Air quality is a best-effort side request on its own host: its own abort
// controller and try/catch so a failure never disturbs the forecast view.
async function refreshAirQuality() {
  if (!location_) return;
  airController?.abort();
  airController = new AbortController();
  const { signal } = airController;
  const loc = location_;
  try {
    const res = await fetch(airQualityUrl(loc.lat, loc.lon), { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const aq = parseAirQuality(await res.json());
    if (loc === location_) renderAirQuality(aq); // ignore stale location results
  } catch { /* air quality is non-essential — leave the page intact */ }
}

// Reflect the active location in the URL so it can be bookmarked/shared.
// replaceState (not push) keeps the back button from filling with cities.
/** @param {Place} loc */
function syncUrl(loc) {
  window.history.replaceState(null, '',
    `${window.location.pathname}?${locationQuery(loc)}`);
}

/** @param {Place} loc */
function setLocation(loc) {
  location_ = loc;
  localStorage.setItem(LS_LOC, JSON.stringify(loc));
  syncUrl(loc);
  renderSavedBar(); // reflect the new active location in the chips
  syncPinButton();
  refresh();
}

// ---- Saved locations (chips) ----

function persistSaved() {
  try { localStorage.setItem(LS_SAVED, JSON.stringify(saved)); }
  catch { /* storage full or unavailable — best effort */ }
}

/** @param {Place | null} loc */
function isSaved(loc) {
  return !!loc && saved.some((s) => sameLoc(s, loc));
}

// Toggle the current location in/out of the saved list (the star button).
function toggleSaved() {
  if (!location_) return;
  if (isSaved(location_)) {
    saved = saved.filter((s) => !sameLoc(s, location_));
  } else {
    saved = [...saved, { name: location_.name, lat: location_.lat, lon: location_.lon }];
  }
  persistSaved();
  renderSavedBar();
  syncPinButton();
}

function syncPinButton() {
  const btn = $('pin-btn');
  const on = isSaved(location_);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('active', on);
  const label = on ? 'Remove saved location' : 'Save this location';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  /** @type {HTMLButtonElement} */ (btn).disabled = !location_;
}

function renderSavedBar() {
  const bar = $('saved-bar');
  if (!bar) return;
  bar.replaceChildren();
  if (!saved.length) { bar.hidden = true; return; }
  const frag = document.createDocumentFragment();
  saved.forEach((place, i) => {
    const active = sameLoc(place, location_);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'saved-chip';
    chip.setAttribute('role', 'listitem');
    chip.setAttribute('aria-grabbed', 'false');
    chip.classList.toggle('active', /** @type {boolean} */ (active));
    chip.setAttribute('aria-current', active ? 'true' : 'false');
    chip.dataset.savedIndex = String(i);
    chip.textContent = place.name;
    chip.title = place.name;
    chip.addEventListener('click', () => {
      if (suppressSavedClick) {
        suppressSavedClick = false;
        return;
      }
      setLocation(place);
    });
    // Reordering uses Pointer Events rather than the native HTML5 drag-and-drop
    // API: native DnD silently does nothing in Firefox here, while pointer
    // events fire identically across Firefox/Chrome/Edge (and touch/pen).
    chip.addEventListener('pointerdown', handleSavedPointerDown);
    frag.appendChild(chip);
  });
  bar.appendChild(frag);
  bar.hidden = false;
}

/**
 * @param {HTMLElement} chip
 * @returns {number}
 */
function savedIndexFromChip(chip) {
  return Number(chip.dataset.savedIndex);
}

function clearSavedDragClasses() {
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.saved-chip')).forEach((chip) => {
    chip.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    chip.setAttribute('aria-grabbed', 'false');
  });
}

/**
 * @param {number} from
 * @param {number} to
 */
function reorderSaved(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return;
  if (from < 0 || from >= saved.length) return;
  const target = Math.max(0, Math.min(saved.length - 1, to));
  if (from === target) return;
  const next = [...saved];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  saved = next;
  persistSaved();
  renderSavedBar();
}

// Pointer-based reordering. We track a press on a chip and only treat it as a
// drag once the pointer travels past a small threshold, so an ordinary tap still
// selects the location. While dragging, the chip under the pointer shows a
// before/after insertion marker; on release we compute the target slot.
const SAVED_DRAG_THRESHOLD = 6; // px of travel before a press becomes a drag

// Topmost saved chip at a point, skipping `exclude` (the chip being dragged —
// it follows the pointer, so it would otherwise sit right under the cursor).
/** @param {number} x @param {number} y @param {HTMLElement} [exclude] @returns {HTMLElement | null} */
function chipAtPoint(x, y, exclude) {
  for (const el of document.elementsFromPoint(x, y)) {
    const chip = /** @type {HTMLElement | null} */ (el.closest?.('.saved-chip'));
    if (chip && chip !== exclude) return chip;
  }
  return null;
}

function clearSavedDragOver() {
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.saved-chip')).forEach((chip) => {
    chip.classList.remove('drag-over-before', 'drag-over-after');
  });
}

/** @param {PointerEvent} e */
function handleSavedPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
  const chip = /** @type {HTMLElement | null} */ (evtEl(e).closest('.saved-chip'));
  if (!chip || saved.length < 2) return; // nothing to reorder
  savedDrag = { chip, fromIndex: savedIndexFromChip(chip), startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dragging: false };
  window.addEventListener('pointermove', handleSavedPointerMove);
  window.addEventListener('pointerup', handleSavedPointerUp);
  window.addEventListener('pointercancel', handleSavedPointerUp);
}

/** @param {PointerEvent} e */
function handleSavedPointerMove(e) {
  if (!savedDrag || e.pointerId !== savedDrag.pointerId) return;
  const dx = e.clientX - savedDrag.startX;
  const dy = e.clientY - savedDrag.startY;
  if (!savedDrag.dragging) {
    if (Math.hypot(dx, dy) < SAVED_DRAG_THRESHOLD) return;
    // Promote to a drag.
    savedDrag.dragging = true;
    draggedSavedIndex = savedDrag.fromIndex;
    savedDrag.chip.classList.add('dragging');
    savedDrag.chip.setAttribute('aria-grabbed', 'true');
  }
  e.preventDefault();
  // Lift the chip and let it track the pointer so the drag is visibly happening.
  savedDrag.chip.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
  clearSavedDragOver();
  const over = chipAtPoint(e.clientX, e.clientY, savedDrag.chip);
  if (over) {
    const rect = over.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    over.classList.toggle('drag-over-before', !after);
    over.classList.toggle('drag-over-after', after);
  }
}

/** @param {PointerEvent} e */
function handleSavedPointerUp(e) {
  if (!savedDrag || e.pointerId !== savedDrag.pointerId) return;
  window.removeEventListener('pointermove', handleSavedPointerMove);
  window.removeEventListener('pointerup', handleSavedPointerUp);
  window.removeEventListener('pointercancel', handleSavedPointerUp);
  const drag = savedDrag;
  savedDrag = null;
  draggedSavedIndex = null;
  if (!drag.dragging) return; // never moved → leave the click to select the place
  const over = e.type === 'pointercancel' ? null : chipAtPoint(e.clientX, e.clientY, drag.chip);
  if (over) {
    let to = savedIndexFromChip(over);
    const rect = over.getBoundingClientRect();
    if (e.clientX > rect.left + rect.width / 2) to += 1;
    if (drag.fromIndex < to) to -= 1;
    reorderSaved(drag.fromIndex, to); // re-renders the bar on a real change
  }
  // A click is synthesized after the drag's pointerup; swallow it so the drag
  // doesn't also navigate. Reset shortly after in case no click follows.
  suppressSavedClick = true;
  window.setTimeout(() => { suppressSavedClick = false; }, 0);
  drag.chip.style.transform = ''; // drop the follow-transform (no-op if re-rendered)
  clearSavedDragClasses();
}

// ---- Tap-a-day (load one day's hours into the hourly graph) ----

// Refresh the "showing <day>" note + Back control, and the day-row pressed state.
function syncDayNote() {
  const note = $('day-note');
  if (!note) return;
  if (selectedDayIso) {
    $('day-note-label').textContent = `Showing ${dayNoteLabel(selectedDayIso)}`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  // Reflect selection on the day rows (today == default view).
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#daily-list .day-row')).forEach((row) => {
    const iso = row.dataset.dayIso;
    const on = selectedDayIso ? iso === selectedDayIso
      : iso === lastData?.daily?.time?.[0];
    row.setAttribute('aria-pressed', on ? 'true' : 'false');
    row.classList.toggle('active', on);
  });
}

/** @param {string} iso */
function dayNoteLabel(iso) {
  const isToday = lastData?.daily?.time?.[0] === iso;
  return isToday ? 'today' : formatWeekday(iso);
}

// Load day i's hours into the hourly graph. Day 0 restores the default 24h view.
/**
 * @param {string} iso
 * @param {number} i
 */
function selectDay(iso, i) {
  if (!lastData) return;
  if (i === 0) { restoreDefaultDay(); return; }
  const hours = sliceDayHours(lastData.hourly, iso);
  if (!hours.length) return;
  selectedDayIso = iso;
  lastHourlyRaw = hours;
  lastHours = groupHours(hours, hourlyResolution);
  renderHourly(lastHours);
  syncDayNote();
}

// Restore the original next-24h view (the "Back" control / tapping today).
function restoreDefaultDay() {
  selectedDayIso = null;
  lastHourlyRaw = defaultDayHours;
  lastHours = groupHours(defaultDayHours, hourlyResolution);
  renderHourly(lastHours);
  syncDayNote();
}

// ---- Search (combobox) ----

/** @param {string} text */
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

/** @param {number} i */
function selectPlace(i) {
  const p = currentPlaces[i];
  if (!p) return;
  /** @type {HTMLInputElement} */ ($('search-input')).value = '';
  closeResults();
  setLocation(p);
}

/** @param {number} delta */
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

/** @param {string} query */
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
    if (/** @type {Error} */ (err).name === 'AbortError') return; // a newer keystroke superseded this
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
      /** @type {Record<number, [string, boolean]>} */
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

/** @param {string | undefined} next */
function setIconSet(next) {
  if (!ICON_SETS.has(/** @type {string} */ (next))) return;
  iconPreviewSet = null;            // committing supersedes any hover/focus preview
  iconSet = /** @type {string} */ (next);
  localStorage.setItem(LS_ICON_SET, iconSet);
  setIconSetControl();
  closeIconSetMenu();
  if (lastData && location_) renderAll(lastData, location_.name, lastUpdatedAt);
}

// ---- Live icon-set preview ----
// Hovering or focusing a menu option re-renders the page in that set so you can
// try it on in context; leaving the menu (or closing it) restores the committed
// set. The persisted selection (`iconSet`) never changes until you actually pick.
/** @type {string | null} */
let iconPreviewSet = null;

/** @param {string} set */
function renderIconsWithSet(set) {
  if (!lastData || !location_) return;
  const committed = iconSet;
  const dayIso = selectedDayIso;   // renderAll resets to the default day; re-apply afterwards
  iconSet = set;
  renderAll(lastData, location_.name, lastUpdatedAt);
  if (dayIso) selectDay(dayIso, 1);
  iconSet = committed;
}

/** @param {string | undefined} set */
function previewIconSet(set) {
  if (!set || !ICON_SETS.has(set)) return;
  if (set === iconSet) { clearIconPreview(); return; } // hovering the active set shows the committed view
  if (set === iconPreviewSet) return;                  // already previewing it — skip the re-render
  iconPreviewSet = set;
  renderIconsWithSet(set);
}

function clearIconPreview() {
  if (iconPreviewSet === null) return;
  iconPreviewSet = null;
  renderIconsWithSet(iconSet);
}

function openIconSetMenu() {
  $('icon-set-menu').hidden = false;
  $('icon-set-btn').setAttribute('aria-expanded', 'true');
}

function closeIconSetMenu() {
  $('icon-set-menu').hidden = true;
  $('icon-set-btn').setAttribute('aria-expanded', 'false');
  clearIconPreview();              // revert any hover/focus preview when the menu goes away
}

function toggleIconSetMenu() {
  if ($('icon-set-menu').hidden) openIconSetMenu();
  else closeIconSetMenu();
}

/** @param {string | undefined} next */
function setModel(next) {
  if (!next || !MODEL_VALUES.has(next)) return;
  model = next;
  localStorage.setItem(LS_MODEL, model);
  setModelControl();
  closeModelMenu();
  refresh(); // a different model is a different data source, so re-fetch
}

function openModelMenu() {
  $('model-menu').hidden = false;
  $('model-btn').setAttribute('aria-expanded', 'true');
}

function closeModelMenu() {
  $('model-menu').hidden = true;
  $('model-btn').setAttribute('aria-expanded', 'false');
}

function toggleModelMenu() {
  if ($('model-menu').hidden) openModelMenu();
  else closeModelMenu();
}

// ---- Events & init ----

/** @type {ReturnType<typeof setTimeout> | undefined} */
let searchDebounce;
$('search-input').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = /** @type {HTMLInputElement} */ (e.target).value;
  searchDebounce = setTimeout(() => doSearch(q), 250);
});
$('search-input').addEventListener('keydown', (e) => {
  const open = !$('search-results').hidden;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (open) moveActive(1); else doSearch(/** @type {HTMLInputElement} */ ($('search-input')).value);
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
  const option = /** @type {HTMLElement | null} */ (evtEl(e).closest('[data-icon-set]'));
  if (option) setIconSet(option.dataset.iconSet);
});
// Live preview: try a set on the whole page while pointing at / focusing its row.
$('icon-set-menu').addEventListener('mouseover', (e) => {
  const option = /** @type {HTMLElement | null} */ (evtEl(e).closest('[data-icon-set]'));
  if (option) previewIconSet(option.dataset.iconSet);
});
$('icon-set-menu').addEventListener('focusin', (e) => {
  const option = /** @type {HTMLElement | null} */ (evtEl(e).closest('[data-icon-set]'));
  if (option) previewIconSet(option.dataset.iconSet);
});
$('icon-set-menu').addEventListener('mouseleave', clearIconPreview);
$('icon-set-btn').addEventListener('keydown', (e) => {
  if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
    e.preventDefault();
    openIconSetMenu();
    /** @type {HTMLElement | null} */ ($('icon-set-menu').querySelector('.active'))?.focus();
  }
});
$('icon-set-menu').addEventListener('keydown', (e) => {
  const options = /** @type {HTMLElement[]} */ ([...$('icon-set-menu').querySelectorAll('[data-icon-set]')]);
  const current = options.indexOf(/** @type {HTMLElement} */ (document.activeElement));
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
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.dataset.iconSet) setIconSet(active.dataset.iconSet);
  }
});
$('model-btn').addEventListener('click', toggleModelMenu);
$('model-menu').addEventListener('click', (e) => {
  const option = /** @type {HTMLElement | null} */ (evtEl(e).closest('[data-model]'));
  if (option) setModel(option.dataset.model);
});
$('model-btn').addEventListener('keydown', (e) => {
  if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
    e.preventDefault();
    openModelMenu();
    /** @type {HTMLElement | null} */ ($('model-menu').querySelector('.active'))?.focus();
  }
});
$('model-menu').addEventListener('keydown', (e) => {
  const options = /** @type {HTMLElement[]} */ ([...$('model-menu').querySelectorAll('[data-model]')]);
  const current = options.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  if (e.key === 'Escape') {
    closeModelMenu();
    $('model-btn').focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    options[(current + 1) % options.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    options[(current - 1 + options.length) % options.length].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.dataset.model) setModel(active.dataset.model);
  }
});
$('unit-btn').addEventListener('click', toggleUnit);
$('scheme-btn').addEventListener('click', cycleScheme);
$('pin-btn').addEventListener('click', toggleSaved);
$('day-back-btn').addEventListener('click', restoreDefaultDay);
$('refresh-btn').addEventListener('click', () => refresh());
$('metric-toggle').addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement | null} */ (evtEl(e).closest('.seg-btn'));
  if (btn) setMetric(/** @type {string} */ (btn.dataset.metric));
});
$('resolution-toggle').addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement | null} */ (evtEl(e).closest('.seg-btn'));
  if (btn) setResolution(Number(btn.dataset.resolution));
});
document.addEventListener('click', (e) => {
  if (!evtEl(e).closest('.search')) closeResults();
  if (!evtEl(e).closest('.icon-set-control')) closeIconSetMenu();
  if (!evtEl(e).closest('.model-control')) closeModelMenu();
});
document.addEventListener('mouseover', (e) => {
  const target = evtEl(e).closest('[data-detail]');
  if (target) showDetailTooltip(target);
});
document.addEventListener('mousemove', () => {
  if (detailTarget && !$('detail-tooltip').hidden) positionDetailTooltip(detailTarget);
});
document.addEventListener('mouseout', (e) => {
  const target = evtEl(e).closest('[data-detail]');
  if (target && !target.contains(/** @type {Node | null} */ (e.relatedTarget))) hideDetailTooltip(target);
});
document.addEventListener('focusin', (e) => {
  const target = evtEl(e).closest('[data-detail]');
  if (target) showDetailTooltip(target);
});
document.addEventListener('focusout', (e) => {
  const target = evtEl(e).closest('[data-detail]');
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
setSchemeControl();
applyScheme();
setIconSetControl();
renderIconSetPreviews();
populateModelMenu();
setModelControl();
syncMetricToggle();
syncResolutionToggle();
renderSavedBar();
syncPinButton();
hydrateFromCache();
refresh();
refreshTimer = setInterval(refresh, 15 * 60 * 1000);

// ---- Service worker removed ----
// There is no service worker anymore. Proactively unregister any copy an earlier
// version installed and drop its caches, so nothing keeps serving stale assets.
// (sw.js now self-destructs too; this is the belt to that suspenders.)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => { /* best effort */ });
}
if (window.caches) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
    .catch(() => { /* best effort */ });
}
