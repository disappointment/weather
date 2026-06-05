# Personal Weather Page — Design

**Date:** 2026-06-04
**Status:** Approved design, pre-implementation

## Summary

A single-page, fully client-side weather forecast app. No backend, no build
step, no API keys. The browser calls Open-Meteo directly (CORS-enabled, free).
Visual style is "Soft & Atmospheric" (option A from brainstorming): large light
temperature, condition-reactive background gradient, frosted cards, generous
whitespace. Hosted on the `otter` k3s cluster via nginx serving static files
from a Kustomize-generated ConfigMap, with Flux pulling the app's own GitHub
repo directly.

## Goals

- Clean, calm, readable weather page usable from any machine in the house.
- Search any city + "use my location"; remembers last location.
- Current conditions, next-24h hourly, 7-day forecast.
- Fahrenheit default with a °F/°C toggle.
- GitOps deployment: edit files → push → Flux reconciles.

## Non-Goals

- No accounts, no server, no database.
- No precipitation radar map, no air-quality, no severe-weather alerts (can be
  added later; kept out to preserve the clean core).
- No build tooling/bundler.

## Data Source: Open-Meteo (keyless, CORS-enabled)

### City search (forward geocoding)
`https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=5&language=en&format=json`
Returns `results[]` with `name`, `admin1` (state/region), `country`,
`latitude`, `longitude`. Render up to 5 matches in a dropdown; selecting one
sets the active location.

### Forecast
`https://api.open-meteo.com/v1/forecast` with:
- `latitude`, `longitude`
- `current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure`
- `hourly=temperature_2m,weather_code,precipitation_probability,is_day,uv_index,visibility`
- `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max`
- `temperature_unit=fahrenheit|celsius` (from toggle)
- `wind_speed_unit=mph`, `precipitation_unit=inch`
- `timezone=auto`

The hourly strip uses the 24 entries starting at the current local hour
(found by matching `hourly.time` to `current.time`).

### "Use my location" (reverse geocoding)
`navigator.geolocation.getCurrentPosition` → lat/lon. Open-Meteo geocoding is
forward-only, so resolve a friendly place name via BigDataCloud's free, keyless,
CORS-enabled endpoint:
`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=<lat>&longitude=<lon>&localityLanguage=en`
Use `city` + `principalSubdivision`. If the call fails, label the location
"Current Location" and proceed with the forecast anyway (the name is cosmetic).

### Weather codes
A local lookup maps WMO `weather_code` → `{ label, icon, theme }`. Covers:
clear, mainly clear, partly cloudy, overcast, fog, drizzle, rain, freezing
rain, snow, snow grains, showers, thunderstorm, thunderstorm w/ hail. Icon and
theme have day/night variants chosen via `is_day`.

## UI / Layout (top → bottom)

1. **Control bar** — search input (with results dropdown), 📍 location button,
   °F/°C toggle. Slim, unobtrusive.
2. **Hero** — place name; large light-weight temperature; condition label;
   "Feels like" (`apparent_temperature`); High/Low (today's daily max/min).
3. **Hourly strip** — next 24h, horizontally scrollable frosted card. Each
   cell: hour · icon · temp, with a precip-probability sub-row.
4. **7-day list** — one row per day: weekday · icon · precip% · low—high range
   bar (a horizontal bar visually spanning the day's min→max).
5. **Detail tiles** — grid of: Wind (speed + direction), Humidity, UV index
   (current hour from `hourly.uv_index`), Sunrise/Sunset, Pressure, Visibility.

### Visual system (style A)
- Full-viewport background gradient selected by `theme` (weather code + day/night).
  Defined themes: `clear-day`, `clear-night`, `partly-day`, `partly-night`,
  `cloudy`, `fog`, `rain`, `snow`, `thunder`. Smooth CSS transition on change.
- Frosted cards: translucent white with `backdrop-filter: blur(...)`, rounded
  corners, soft shadow.
- Typography: system UI stack, light weights for big numbers.
- Icons: a small inline-SVG set (sun, moon, cloud, partly-cloud, rain, snow,
  fog, thunder) — no icon-font/CDN dependency.
- Responsive: comfortable on phone and desktop; single column, max-width
  container, fluid type.

## Code Structure (weather repo)

Three hand-authored files plus deployment manifests. Kept separate for clarity;
no inline blobs.

```
weather/                     (own GitHub repo, public)
  index.html                 markup + SVG icon <defs>
  styles.css                 all styling, gradient theme classes
  app.js                     logic, organized into small functions
  README.md                  run-locally + deploy notes
  kustomization.yaml         AT REPO ROOT (configMapGenerator needs this)
  deploy/
    namespace.yaml
    deployment.yaml          nginx:alpine, mounts the ConfigMap
    service.yaml             NodePort 30095
  docs/superpowers/specs/    this spec
```

`app.js` responsibilities (each a small, single-purpose unit):
- `geocodeSearch(query)` → list of place matches
- `reverseGeocode(lat, lon)` → place name (with fallback)
- `fetchForecast(lat, lon, unit)` → normalized forecast object
- `WEATHER_CODES` map → `{ label, icon, theme }`
- `pickTheme(code, isDay)` and `applyTheme(theme)`
- `renderHero`, `renderHourly`, `renderDaily`, `renderTiles`
- `loadLocation` / `saveLocation` (localStorage), `setUnit`
- top-level `refresh()` orchestrator

### State & persistence
- `localStorage["weather.location"]` = `{ name, lat, lon }`
- `localStorage["weather.unit"]` = `"fahrenheit" | "celsius"`
- Changing units re-fetches from Open-Meteo in the requested units (accurate,
  cheap — no client-side conversion drift).
- Light auto-refresh: re-fetch on tab regaining focus and every 15 minutes.

## Error / Edge Handling

- **Forecast/network failure:** inline, non-blocking message; keep the
  last-rendered data on screen if any.
- **Geolocation denied/unavailable:** silently fall back to search (no nag).
- **Reverse-geocode failure:** use "Current Location" label, still show forecast.
- **Empty / no-match search:** "No place found" in the dropdown.
- **First visit, no saved location:** empty state inviting search or 📍. No
  automatic geolocation permission prompt on load.

## Hosting on otter (GitOps)

Static files are served by stock `nginx:alpine`. The three site files become a
ConfigMap via Kustomize `configMapGenerator` (same pattern as the existing
`homepage` app, `apps/homepage/kustomization.yaml`). The ConfigMap is mounted at
`/usr/share/nginx/html`. Kustomize appends a content hash to the ConfigMap name,
so nginx auto-restarts when files change.

### weather repo — `kustomization.yaml` (root)
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
      - app.js
```

### weather repo — `deploy/deployment.yaml`
nginx:alpine, 1 replica, Recreate strategy, mounts `weather-site` ConfigMap at
`/usr/share/nginx/html` (read-only). Liveness + readiness `httpGet: / :80`.
TZ America/New_York.

### weather repo — `deploy/service.yaml`
`type: NodePort`, port 80 → `nodePort: 30095` (next free per otter-flux table).

### otter-flux — `clusters/otter/weather.yaml` (the only otter-flux change for wiring)
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
  url: https://github.com/disappointment/weather   # public → no secretRef
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
This file sits under `clusters/otter/`, which Flux already reconciles (path
`./clusters/otter` in `gotk-sync.yaml`), so adding it registers the new source.
The exact GitHub org/owner (`disappointment` assumed from the otter-flux remote)
is confirmed when the repo is created.

### Remaining otter-flux conventions
- Homepage tile: add a "Weather" entry under an appropriate section in
  `apps/homepage/config/services.yaml`, then restart the homepage deployment.
- Uptime Kuma: after deploy, add an HTTP monitor for `:30095` via the UI and
  attach it to the "homelab" status page.
- Update the port table in `otter-flux/CLAUDE.md` (mark 30095 → Weather, set
  next available to 30096).

### Access
Reachable from any house machine at `http://192.168.68.89:30095` (and via the
Homepage dashboard tile).

## Deploy Flow (steady state)
1. Edit `index.html` / `styles.css` / `app.js` in the weather repo.
2. Local preview: open `index.html` directly in a browser.
3. `git push` to the weather repo's `main`.
4. Reconcile otter:
   `ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl annotate gitrepository/weather -n flux-system reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite'`

## Testing / Verification
- **Local:** open `index.html`; verify search, geolocation fallback, unit
  toggle, all five sections render, and the background theme changes for
  different conditions (can be exercised by temporarily forcing weather codes).
- **Manifests:** `kustomize build .` at the repo root produces valid YAML with
  the ConfigMap populated.
- **Cluster:** after first reconcile, `ssh otter` and confirm the `weather`
  Kustomization is Ready, pod is Running, and the page loads on `:30095`.

## Open Items (confirmed at implementation time, not blocking)
- GitHub owner/org for the weather repo (assume `disappointment`, public).
- Final exact gradient color stops per theme (tuned during build).
