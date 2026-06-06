// Pure, browser-agnostic weather helpers. No DOM/fetch here.

// ---- Domain typedefs (JSDoc only; no runtime effect) ----

/**
 * WMO weather-code group keys used to pick icons/themes.
 * @typedef {'clear'|'partly'|'cloudy'|'fog'|'drizzle'|'rain'|'snow'|'thunder'} WeatherGroup
 */

/**
 * Result of describeWeather: a human label plus icon/theme keys.
 * @typedef {object} WeatherDescription
 * @property {string} label
 * @property {string} icon
 * @property {string} theme
 */

/**
 * Temperature unit accepted across the helpers.
 * @typedef {'celsius'|'fahrenheit'} TemperatureUnit
 */

/**
 * Unit choices derived from the temperature unit.
 * @typedef {object} UnitConfig
 * @property {TemperatureUnit} temperatureUnit
 * @property {'kmh'|'mph'} windSpeedUnit
 * @property {'mm'|'inch'} precipitationUnit
 * @property {string} windLabel
 * @property {string} distanceLabel
 * @property {(m: number) => number} distanceFrom
 */

/**
 * Open-Meteo hourly block: parallel arrays indexed by hour. Some series are
 * only present when requested; those are optional.
 * @typedef {object} HourlyData
 * @property {string[]} time
 * @property {number[]} temperature_2m
 * @property {number[]} weather_code
 * @property {number[]} is_day
 * @property {number[]} precipitation_probability
 * @property {number[]} uv_index
 * @property {number[]} visibility
 * @property {number[]} [wind_speed_10m]
 * @property {number[]} [relative_humidity_2m]
 * @property {number[]} [apparent_temperature]
 * @property {number[]} [dew_point_2m]
 * @property {number[]} [wind_gusts_10m]
 * @property {number[]} [cloud_cover]
 */

/**
 * A single hour extracted from the hourly block. Fields whose source series is
 * optional may be undefined.
 * @typedef {object} HourSample
 * @property {string} time
 * @property {number} temp
 * @property {number} code
 * @property {number} isDay
 * @property {number} precip
 * @property {number} uv
 * @property {number} visibility
 * @property {number} [wind]
 * @property {number} [humidity]
 * @property {number} [feels]
 * @property {number} [dew]
 * @property {number} [gust]
 * @property {number} [cloud]
 */

/**
 * A grouped block summarizing a window of hours.
 * @typedef {object} HourBlock
 * @property {string} time
 * @property {number} isDay
 * @property {number} code
 * @property {number} [temp]
 * @property {number} [precip]
 * @property {number} [wind]
 * @property {number} [humidity]
 * @property {number} [feels]
 */

/**
 * A 2D point in the sparkline's pixel space.
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * Geometry for lineGraph.
 * @typedef {object} GraphGeom
 * @property {number} pitch
 * @property {number} offsetX
 * @property {number} height
 * @property {number} padY
 */

/**
 * Optional y-domain pin for lineGraph.
 * @typedef {object} GraphDomain
 * @property {number} [min]
 * @property {number} [max]
 */

/**
 * lineGraph output: SVG path data plus the raw points and resolved domain.
 * @typedef {object} LineGraph
 * @property {string} line
 * @property {string} area
 * @property {Point[]} points
 * @property {number} min
 * @property {number} max
 */

/**
 * A geocoded place.
 * @typedef {object} Place
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 */

/**
 * Parsed air-quality readings. Any field may be undefined when the source
 * provides no value. Pollen series are only modelled in Europe, so they are
 * commonly absent elsewhere.
 * @typedef {object} AirQuality
 * @property {number} [usAqi]
 * @property {number} [pm25]
 * @property {number} [pm10]
 * @property {number} [ozone]
 * @property {number} [europeanAqi]
 * @property {number} [grassPollen]
 * @property {number} [birchPollen]
 * @property {number} [alderPollen]
 * @property {number} [ragweedPollen]
 * @property {number} [mugwortPollen]
 * @property {number} [olivePollen]
 */

/**
 * One golden-hour window (soft, warm light) as local ISO strings.
 * @typedef {object} GoldenWindow
 * @property {string} start
 * @property {string} end
 */

/**
 * The two daily golden-hour windows around sunrise and sunset.
 * @typedef {object} GoldenHour
 * @property {GoldenWindow} morning
 * @property {GoldenWindow} evening
 */

/**
 * A moon-phase reading for a moment in time.
 * @typedef {object} MoonPhase
 * @property {number} phase
 * @property {number} illumination
 * @property {string} name
 * @property {string} emoji
 */

/**
 * How far through the daylight period a moment sits.
 * @typedef {object} DaylightProgress
 * @property {number} fraction 0..1 from sunrise to sunset (clamped)
 * @property {boolean} isDaytime whether now is between sunrise and sunset
 * @property {number} dayLengthMin minutes of daylight
 */

/**
 * A single minutely_15 precipitation sample.
 * @typedef {object} MinutelySample
 * @property {string} time
 * @property {number} precip
 */

// code -> [label, group]
/** @type {Record<number, [string, WeatherGroup]>} */
export const CODE_TABLE = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'partly'],
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

/** @type {Record<WeatherGroup, (d: boolean) => string>} */
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

/** @type {Record<WeatherGroup, (d: boolean) => string>} */
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

/**
 * Map a WMO code + day flag to a label, icon, and theme.
 * @param {number} code
 * @param {number|string|boolean} isDay
 * @returns {WeatherDescription}
 */
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

/**
 * Floor an ISO timestamp to the top of its hour (YYYY-MM-DDThh:00).
 * @param {string} iso
 * @returns {string}
 */
export function floorToHour(iso) {
  return iso.slice(0, 13) + ':00';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/**
 * Convert a wind bearing in degrees to an 8-point compass label.
 * @param {number} deg
 * @returns {string}
 */
export function degToCompass(deg) {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/**
 * @param {number} m
 * @returns {number}
 */
export function metersToMiles(m) {
  return Math.round((m / 1609.344) * 10) / 10;
}

/**
 * @param {number} m
 * @returns {number}
 */
export function metersToKm(m) {
  return Math.round((m / 1000) * 10) / 10;
}

// Single source of truth for unit choices, derived from the temperature unit.
// Keeps wind/precip/distance consistent instead of mixing metric and imperial.
/**
 * @param {TemperatureUnit} temperatureUnit
 * @returns {UnitConfig}
 */
export function unitConfig(temperatureUnit) {
  const metric = temperatureUnit === 'celsius';
  return {
    temperatureUnit,
    windSpeedUnit: metric ? 'kmh' : 'mph',
    precipitationUnit: metric ? 'mm' : 'inch',
    windLabel: metric ? 'km/h' : 'mph',
    distanceLabel: metric ? 'km' : 'mi',
    distanceFrom: metric ? metersToKm : metersToMiles,
  };
}

/**
 * Position a day's temperature range within the week's overall range, as
 * percentages for a CSS bar.
 * @param {number} min
 * @param {number} max
 * @param {number} weekMin
 * @param {number} weekMax
 * @returns {{ left: number, width: number }}
 */
export function rangeBar(min, max, weekMin, weekMax) {
  const span = weekMax - weekMin;
  if (span <= 0) return { left: 0, width: 100 };
  const left = ((min - weekMin) / span) * 100;
  const width = ((max - min) / span) * 100;
  return { left: Math.round(left), width: Math.round(width) };
}

// Build SVG path data for a sparkline over evenly spaced values (temp, precip,
// wind, ...). geom: { pitch, offsetX, height, padY }. domain optionally pins
// min/max (e.g. precip 0..100); otherwise the data's own range is used.
// Returns smooth line + filled area paths plus the raw points.
/**
 * @param {number[]} values
 * @param {GraphGeom} geom
 * @param {GraphDomain} [domain]
 * @returns {LineGraph}
 */
export function lineGraph(values, geom, domain = {}) {
  const { pitch, offsetX, height, padY } = geom;
  // Skip missing/non-numeric values (API gaps) but keep x tied to the original
  // index so the curve stays aligned with the cells. Need >=2 to draw.
  const valid = values
    .map((t, i) => ({ t, i }))
    .filter((e) => Number.isFinite(e.t));
  if (valid.length < 2) return { line: '', area: '', points: [], min: 0, max: 0 };
  const ts = valid.map((e) => e.t);
  const min = domain.min ?? Math.min(...ts);
  const max = domain.max ?? Math.max(...ts);
  const span = max - min || 1; // avoid divide-by-zero on a flat series
  const usable = height - 2 * padY;
  /** @param {number} v */
  const r = (v) => Math.round(v * 100) / 100;
  const points = valid.map(({ t, i }) => {
    const f = Math.min(1, Math.max(0, (t - min) / span)); // clamp into domain
    return { x: r(offsetX + pitch * i), y: r(padY + (1 - f) * usable) };
  });
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const area = `${line} L ${last.x} ${height} L ${points[0].x} ${height} Z`;
  return { line, area, points, min, max };
}

// Catmull-Rom -> cubic Bezier for a smooth curve through every point.
/**
 * @param {Point[]} pts
 * @returns {string}
 */
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  /** @param {number} v */
  const r = (v) => Math.round(v * 100) / 100;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/**
 * Extract up to 24 hours starting at the current hour.
 * @param {HourlyData} hourly
 * @param {string} currentIso
 * @returns {HourSample[]}
 */
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
      wind: hourly.wind_speed_10m?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      uv: hourly.uv_index[i],
      visibility: hourly.visibility[i],
      feels: hourly.apparent_temperature?.[i],
      dew: hourly.dew_point_2m?.[i],
      gust: hourly.wind_gusts_10m?.[i],
      cloud: hourly.cloud_cover?.[i],
    });
  }
  return out;
}

// Aggregate hourly entries into fixed-size blocks (e.g. 3-hourly). Each block
// summarizes its window so nothing between samples is lost: average temp,
// max precip/wind, and the most significant condition (highest WMO code).
/**
 * Aggregate hourly samples into fixed-size blocks.
 * @param {HourSample[]} hours
 * @param {number} [size]
 * @returns {HourBlock[]}
 */
export function groupHours(hours, size = 3) {
  /** @param {number[]} xs */
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  /**
   * Keep only finite numbers, narrowing out undefined gaps.
   * @param {(number|undefined)[]} xs
   * @returns {number[]}
   */
  const finite = (xs) => xs.filter(
    /** @returns {x is number} */ (x) => Number.isFinite(x));
  const blocks = [];
  for (let i = 0; i < hours.length; i += size) {
    const chunk = hours.slice(i, i + size);
    const temps = finite(chunk.map((h) => h.temp));
    const precs = finite(chunk.map((h) => h.precip));
    const winds = finite(chunk.map((h) => h.wind));
    const hums = finite(chunk.map((h) => h.humidity));
    const feelses = finite(chunk.map((h) => h.feels));
    const codes = finite(chunk.map((h) => h.code));
    blocks.push({
      time: chunk[0].time,
      isDay: chunk[0].isDay,
      temp: temps.length ? avg(temps) : undefined,
      precip: precs.length ? Math.max(...precs) : undefined,
      wind: winds.length ? Math.max(...winds) : undefined,
      humidity: hums.length ? avg(hums) : undefined,
      feels: feelses.length ? avg(feelses) : undefined,
      code: codes.length ? Math.max(...codes) : chunk[0].code,
    });
  }
  return blocks;
}

const CURRENT = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
  'is_day', 'precipitation', 'weather_code', 'wind_speed_10m',
  'wind_direction_10m', 'surface_pressure',
].join(',');

const HOURLY = [
  'temperature_2m', 'weather_code', 'precipitation_probability',
  'is_day', 'uv_index', 'visibility', 'wind_speed_10m',
  'relative_humidity_2m', 'apparent_temperature', 'dew_point_2m',
  'wind_gusts_10m', 'cloud_cover',
].join(',');

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max',
].join(',');

/**
 * @param {number} lat
 * @param {number} lon
 * @param {TemperatureUnit} unit
 * @returns {string}
 */
export function forecastUrl(lat, lon, unit) {
  const u = unitConfig(unit);
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    minutely_15: 'precipitation',
    forecast_minutely_15: '48', // 48 quarter-hours = next 12h of nowcast
    temperature_unit: u.temperatureUnit,
    wind_speed_unit: u.windSpeedUnit,
    precipitation_unit: u.precipitationUnit,
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

/**
 * @param {string} query
 * @returns {string}
 */
export function geocodeUrl(query) {
  const p = new URLSearchParams({
    name: query, count: '5', language: 'en', format: 'json',
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${p.toString()}`;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function reverseGeocodeUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), localityLanguage: 'en',
  });
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?${p.toString()}`;
}

// A location lives in the URL as ?q=<name>&lat=<n>&lon=<n> so it can be
// bookmarked/shared. Coords are authoritative on load; q is just readable.
/**
 * Parse a location from a URL query string, or null if coords are missing/invalid.
 * @param {string} search
 * @returns {Place | null}
 */
export function parseLocationParams(search) {
  const p = new URLSearchParams(search);
  const lat = parseFloat(p.get('lat') ?? '');
  const lon = parseFloat(p.get('lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: p.get('q') || 'Pinned location', lat, lon };
}

/**
 * Serialize a location into a URL query string.
 * @param {Place} loc
 * @returns {string}
 */
export function locationQuery(loc) {
  /** @param {number} n */
  const round = (n) => Math.round(n * 1e4) / 1e4; // ~11m precision, tidy URLs
  const p = new URLSearchParams();
  p.set('q', loc.name);
  p.set('lat', String(round(loc.lat)));
  p.set('lon', String(round(loc.lon)));
  return p.toString();
}

/**
 * Map a geocoding API response to Place objects.
 * @param {any} json
 * @returns {Place[]}
 */
export function parsePlaces(json) {
  /** @type {any[]} */
  const results = (json && json.results) || [];
  return results.map((/** @type {any} */ r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// Open-Meteo air-quality API lives on a separate host from the forecast API.
/**
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function airQualityUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'us_aqi,pm2_5,pm10,ozone,european_aqi,' +
      'grass_pollen,birch_pollen,alder_pollen,ragweed_pollen,' +
      'mugwort_pollen,olive_pollen',
    timezone: 'auto',
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${p.toString()}`;
}

/**
 * Map an air-quality API response to a flat AirQuality object.
 * @param {any} json
 * @returns {AirQuality}
 */
export function parseAirQuality(json) {
  const c = (json && json.current) || {};
  return {
    usAqi: c.us_aqi,
    pm25: c.pm2_5,
    pm10: c.pm10,
    ozone: c.ozone,
    europeanAqi: c.european_aqi,
    grassPollen: c.grass_pollen,
    birchPollen: c.birch_pollen,
    alderPollen: c.alder_pollen,
    ragweedPollen: c.ragweed_pollen,
    mugwortPollen: c.mugwort_pollen,
    olivePollen: c.olive_pollen,
  };
}

// Pollen types we surface, paired with the AirQuality key holding their count.
/** @type {[string, keyof AirQuality][]} */
const POLLEN_TYPES = [
  ['Grass', 'grassPollen'],
  ['Birch', 'birchPollen'],
  ['Alder', 'alderPollen'],
  ['Ragweed', 'ragweedPollen'],
  ['Mugwort', 'mugwortPollen'],
  ['Olive', 'olivePollen'],
];

// Generic grains/m³ scale. Per-species thresholds differ, but this gives a
// useful at-a-glance band that holds across types.
/**
 * Categorize a pollen concentration (grains/m³).
 * @param {number|undefined} grains
 * @returns {string}
 */
export function pollenCategory(grains) {
  if (typeof grains !== 'number' || !Number.isFinite(grains)) return 'Unknown';
  if (grains < 1) return 'None';
  if (grains < 20) return 'Low';
  if (grains < 50) return 'Moderate';
  if (grains < 100) return 'High';
  return 'Very high';
}

// One-line pollen summary, or null when no pollen series are present (the usual
// case outside Europe). Lists each available type with its band.
/**
 * @param {AirQuality} aq
 * @returns {string|null}
 */
export function pollenSummary(aq) {
  const present = POLLEN_TYPES
    .map(([label, key]) => /** @type {[string, number]} */ ([label, aq[key]]))
    .filter(([, v]) => Number.isFinite(v));
  if (!present.length) return null;
  return present
    .map(([label, v]) => `${label.toLowerCase()} ${pollenCategory(v).toLowerCase()}`)
    .join(', ');
}

// Golden hour ≈ the hour the sun sits low and warm: just after sunrise and just
// before sunset. A fixed 60-min window approximates the sun-elevation band
// (~-4°..+6°) closely enough without a solar-position model.
/**
 * @param {string} sunriseIso local ISO timestamp
 * @param {string} sunsetIso local ISO timestamp
 * @returns {GoldenHour}
 */
export function goldenHour(sunriseIso, sunsetIso) {
  return {
    morning: { start: sunriseIso.slice(0, 16), end: shiftIso(sunriseIso, 60) },
    evening: { start: shiftIso(sunsetIso, -60), end: sunsetIso.slice(0, 16) },
  };
}

// Shift a local ISO time by some minutes, returning a local 'YYYY-MM-DDTHH:MM'
// string. Parsing and formatting both in local time keeps the offset stable
// regardless of the runtime's timezone.
/**
 * @param {string} iso
 * @param {number} minutes
 * @returns {string}
 */
function shiftIso(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  /** @param {number} n */
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const MOON_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];
const MOON_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const SYNODIC_MS = 29.530588853 * 86400000; // mean lunar month
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

// Moon phase from the synodic cycle since a reference new moon. phase is a
// 0..1 fraction (0 = new, 0.5 = full); illumination is the lit fraction 0..1.
/**
 * @param {Date} date
 * @returns {MoonPhase}
 */
export function moonPhase(date) {
  const elapsed = date.getTime() - NEW_MOON_REF;
  const phase = (((elapsed % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS) / SYNODIC_MS;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const idx = Math.round(phase * 8) % 8;
  return { phase, illumination, name: MOON_NAMES[idx], emoji: MOON_EMOJI[idx] };
}

// Position of `now` within today's daylight, for a sunrise→sunset progress bar.
// fraction clamps to [0,1] so the marker stays on the track before dawn / after
// dusk; isDaytime says whether the sun is actually up right now.
/**
 * @param {string} sunriseIso
 * @param {string} sunsetIso
 * @param {string} nowIso
 * @returns {DaylightProgress}
 */
export function daylightProgress(sunriseIso, sunsetIso, nowIso) {
  const rise = new Date(sunriseIso).getTime();
  const set = new Date(sunsetIso).getTime();
  const now = new Date(nowIso).getTime();
  const span = set - rise;
  if (!Number.isFinite(span) || span <= 0) {
    return { fraction: 0, isDaytime: false, dayLengthMin: 0 };
  }
  const fraction = Math.min(1, Math.max(0, (now - rise) / span));
  return {
    fraction,
    isDaytime: now >= rise && now <= set,
    dayLengthMin: Math.round(span / 60000),
  };
}

// "13h 52m" / "47m" from a minute count.
/**
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// US AQI breakpoints (EPA): map an index value to its health category.
/**
 * Map a US AQI value to its EPA health category.
 * @param {number|undefined} usAqi
 * @returns {string}
 */
export function aqiCategory(usAqi) {
  if (typeof usAqi !== 'number' || !Number.isFinite(usAqi)) return 'Unknown';
  if (usAqi <= 50) return 'Good';
  if (usAqi <= 100) return 'Moderate';
  if (usAqi <= 150) return 'Unhealthy for sensitive';
  if (usAqi <= 200) return 'Unhealthy';
  if (usAqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

// Like sliceNext24 but pulls every hour belonging to one calendar day (by ISO
// date prefix), so the graph can show a specific future/past day in full.
/**
 * Extract every hour whose ISO timestamp begins with the given date prefix.
 * @param {HourlyData} hourly
 * @param {string} dateIso
 * @returns {HourSample[]}
 */
export function sliceDayHours(hourly, dateIso) {
  const out = [];
  for (let i = 0; i < hourly.time.length; i++) {
    if (!hourly.time[i].startsWith(dateIso)) continue;
    out.push({
      time: hourly.time[i],
      temp: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
      isDay: hourly.is_day[i],
      precip: hourly.precipitation_probability[i],
      wind: hourly.wind_speed_10m?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      uv: hourly.uv_index[i],
      visibility: hourly.visibility[i],
      feels: hourly.apparent_temperature?.[i],
      dew: hourly.dew_point_2m?.[i],
      gust: hourly.wind_gusts_10m?.[i],
      cloud: hourly.cloud_cover?.[i],
    });
  }
  return out;
}

// Minutely_15 precipitation nowcast: keep samples at/after the current time,
// capped to the next 12h (48 quarter-hours).
/**
 * Extract minutely_15 precipitation samples at/after the current time, capped
 * at the next 12 h (48 quarter-hours).
 * @param {any} data
 * @returns {MinutelySample[]}
 */
export function parseMinutely(data) {
  const m = (data && data.minutely_15) || {};
  const times = m.time || [];
  const precs = m.precipitation || [];
  const now = data && data.current ? data.current.time : undefined;
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (now && times[i] < now) continue;
    out.push({ time: times[i], precip: precs[i] });
    if (out.length >= 48) break;
  }
  return out;
}

// Turn nowcast samples into a one-line human summary. Pure: no formatting libs.
/**
 * Turn nowcast samples into a one-line human summary.
 * @param {MinutelySample[]} samples
 * @returns {string}
 */
export function nowcastText(samples) {
  const list = samples || [];
  const finite = list.filter((s) => Number.isFinite(s.precip));
  if (!finite.length || finite.every((s) => Math.abs(s.precip) < 0.001)) {
    return 'No precipitation expected in the next 12 h.';
  }
  const now = finite[0];
  if (Number.isFinite(now.precip) && now.precip > 0) {
    const x = Math.round(now.precip * 10) / 10;
    return `Precipitation now, ~${x}mm/h.`;
  }
  const next = finite.find((s) => s.precip > 0.2);
  if (next) {
    const when = new Date(next.time).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    return `Precipitation likely around ${when}.`;
  }
  return 'No precipitation expected in the next 12 h.';
}
