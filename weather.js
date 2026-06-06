// Pure, browser-agnostic weather helpers. No DOM/fetch here.

// code -> [label, group]
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

export function metersToKm(m) {
  return Math.round((m / 1000) * 10) / 10;
}

// Single source of truth for unit choices, derived from the temperature unit.
// Keeps wind/precip/distance consistent instead of mixing metric and imperial.
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
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
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
    });
  }
  return out;
}

// Aggregate hourly entries into fixed-size blocks (e.g. 3-hourly). Each block
// summarizes its window so nothing between samples is lost: average temp,
// max precip/wind, and the most significant condition (highest WMO code).
export function groupHours(hours, size = 3) {
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const blocks = [];
  for (let i = 0; i < hours.length; i += size) {
    const chunk = hours.slice(i, i + size);
    const temps = chunk.map((h) => h.temp).filter(Number.isFinite);
    const precs = chunk.map((h) => h.precip).filter(Number.isFinite);
    const winds = chunk.map((h) => h.wind).filter(Number.isFinite);
    const hums = chunk.map((h) => h.humidity).filter(Number.isFinite);
    const codes = chunk.map((h) => h.code).filter(Number.isFinite);
    blocks.push({
      time: chunk[0].time,
      isDay: chunk[0].isDay,
      temp: temps.length ? avg(temps) : undefined,
      precip: precs.length ? Math.max(...precs) : undefined,
      wind: winds.length ? Math.max(...winds) : undefined,
      humidity: hums.length ? avg(hums) : undefined,
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
  'relative_humidity_2m',
].join(',');

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max',
].join(',');

export function forecastUrl(lat, lon, unit) {
  const u = unitConfig(unit);
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    temperature_unit: u.temperatureUnit,
    wind_speed_unit: u.windSpeedUnit,
    precipitation_unit: u.precipitationUnit,
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

// A location lives in the URL as ?q=<name>&lat=<n>&lon=<n> so it can be
// bookmarked/shared. Coords are authoritative on load; q is just readable.
export function parseLocationParams(search) {
  const p = new URLSearchParams(search);
  const lat = parseFloat(p.get('lat'));
  const lon = parseFloat(p.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: p.get('q') || 'Pinned location', lat, lon };
}

export function locationQuery(loc) {
  const round = (n) => Math.round(n * 1e4) / 1e4; // ~11m precision, tidy URLs
  const p = new URLSearchParams();
  p.set('q', loc.name);
  p.set('lat', round(loc.lat));
  p.set('lon', round(loc.lon));
  return p.toString();
}

export function parsePlaces(json) {
  const results = (json && json.results) || [];
  return results.map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
