// RainViewer radar overlay on a Leaflet map.
//
// This is an ES module (imported by app.js with a relative path) but it does NOT
// import Leaflet — the app has no bundler, so Leaflet ships from a pinned CDN and
// exposes the global `window.L`. We read that global lazily, only once the radar
// card is actually shown, so a missing/blocked CDN never breaks the rest of the app.
//
// Radar is online-only: every network call is guarded, and any failure leaves the
// base map (or nothing) in place without throwing.

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

let map = null;            // the Leaflet map instance (created once)
let baseLayer = null;      // OSM base tiles
let frames = [];           // [{ path, time }] past + nowcast, ordered oldest→newest
let host = '';             // RainViewer tile host
let frameLayers = [];      // L.tileLayer per frame, lazily created and cached
let activeIndex = -1;      // currently visible frame index
let playTimer = null;      // setInterval handle while playing
let lastLoc = null;        // remember the last center for re-centering

const FRAME_OPACITY = 0.6;
const PLAY_INTERVAL_MS = 700;

function L() { return window.L; }

// Lazily create the Leaflet map + OSM base layer. Safe to call repeatedly:
// it no-ops once the map exists, and returns false if Leaflet isn't available yet.
export function initRadar() {
  if (map) return true;
  const leaflet = L();
  const el = document.getElementById('radar-map');
  if (!leaflet || !el) return false;

  map = leaflet.map(el, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false, // avoid hijacking page scroll
  }).setView([20, 0], 4);

  baseLayer = leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  wireControls();
  return true;
}

function wireControls() {
  const play = /** @type {HTMLButtonElement | null} */ (document.getElementById('radar-play'));
  const scrub = /** @type {HTMLInputElement | null} */ (document.getElementById('radar-scrub'));
  if (play) play.addEventListener('click', togglePlay);
  if (scrub) {
    scrub.addEventListener('input', () => {
      stopPlay();
      showFrame(Number(scrub.value));
    });
  }
}

// Re-center to loc and (re)load RainViewer frames. Creates the map first if needed.
export async function updateRadar(loc) {
  if (!loc) return;
  lastLoc = loc;
  if (!initRadar()) return; // Leaflet not ready — nothing to do
  // Leaflet needs a size recompute when the card was hidden during creation.
  map.invalidateSize();
  map.setView([loc.lat, loc.lon], 7);
  await loadFrames();
}

async function loadFrames() {
  try {
    const res = await fetch(RAINVIEWER_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    host = data.host || '';
    const past = data.radar?.past || [];
    const nowcast = data.radar?.nowcast || [];
    frames = [...past, ...nowcast].filter((f) => f && f.path);
  } catch {
    frames = []; // radar is online-only; leave the base map untouched
  }
  resetFrameLayers();
  if (!frames.length) {
    syncControls();
    return;
  }
  // Default to the latest past frame (the most recent real observation).
  const startIndex = Math.min(frames.length - 1, Math.max(0, lastPastIndex()));
  syncControls();
  showFrame(startIndex);
}

// Index of the newest "past" frame: nowcast frames have a time in the future.
function lastPastIndex() {
  const now = Date.now() / 1000;
  let idx = 0;
  frames.forEach((f, i) => { if (Number(f.time) <= now) idx = i; });
  return idx;
}

function resetFrameLayers() {
  const leaflet = L();
  if (map && leaflet) {
    frameLayers.forEach((layer) => { if (layer) map.removeLayer(layer); });
  }
  frameLayers = new Array(frames.length).fill(null);
  activeIndex = -1;
}

// Build (or reuse) the tile layer for a frame. RainViewer tile URL scheme:
//   host + frame.path + '/256/{z}/{x}/{y}/<color>/<options>.png'
// color 2 = "Universal Blue", options 1_1 = smooth + snow.
function frameLayer(i) {
  if (frameLayers[i]) return frameLayers[i];
  const leaflet = L();
  const frame = frames[i];
  if (!leaflet || !frame || !host) return null;
  const url = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  const layer = leaflet.tileLayer(url, { opacity: 0, maxZoom: 18, tileSize: 256 });
  layer.addTo(map);
  frameLayers[i] = layer;
  return layer;
}

// Swap the visible frame by toggling opacity (old → 0, new → FRAME_OPACITY).
function showFrame(i) {
  if (i < 0 || i >= frames.length) return;
  const next = frameLayer(i);
  if (!next) return;
  if (activeIndex >= 0 && activeIndex !== i && frameLayers[activeIndex]) {
    frameLayers[activeIndex].setOpacity(0);
  }
  next.setOpacity(FRAME_OPACITY);
  activeIndex = i;
  syncControls();
}

function syncControls() {
  const scrub = /** @type {HTMLInputElement | null} */ (document.getElementById('radar-scrub'));
  const time = document.getElementById('radar-time');
  const play = /** @type {HTMLButtonElement | null} */ (document.getElementById('radar-play'));
  const has = frames.length > 0;
  if (scrub) {
    scrub.max = String(Math.max(0, frames.length - 1));
    scrub.disabled = !has;
    if (activeIndex >= 0) scrub.value = String(activeIndex);
  }
  if (play) play.disabled = !has;
  if (time) {
    const f = frames[activeIndex];
    time.textContent = f ? formatFrameTime(f.time) : (has ? '' : 'Radar unavailable');
  }
}

function formatFrameTime(unixSeconds) {
  if (!Number.isFinite(Number(unixSeconds))) return '';
  return new Date(Number(unixSeconds) * 1000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function togglePlay() {
  if (playTimer) stopPlay();
  else startPlay();
}

function startPlay() {
  if (!frames.length) return;
  setPlayLabel(true);
  playTimer = setInterval(() => {
    const next = (activeIndex + 1) % frames.length;
    showFrame(next);
  }, PLAY_INTERVAL_MS);
}

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  setPlayLabel(false);
}

function setPlayLabel(playing) {
  const play = /** @type {HTMLButtonElement | null} */ (document.getElementById('radar-play'));
  if (!play) return;
  play.textContent = playing ? '❚❚' : '▶';
  const label = playing ? 'Pause radar animation' : 'Play radar animation';
  play.setAttribute('aria-label', label);
  play.title = label;
}
