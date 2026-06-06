# Weather

A clean, client-side weather forecast page. Data from Open-Meteo (no API key).

## Features
- Current conditions, hourly forecast, and a multi-day outlook with condition-driven theming.
- Interactive hourly graph — switch metrics (temp, precip, wind, humidity, UV), points on every hour (labelled every 3rd), feels-like ghost line, and day/night shading.
- Tap a forecast day to load its hours into the graph.
- Feels-like temperature, US AQI + pollen card, and a precipitation nowcast ("rain likely around…").
- Sun tiles: sunrise/sunset, golden-hour windows, and current moon phase.
- RainViewer radar overlay (Leaflet) with a playable timeline.
- Saved locations, search + geolocation, °F/°C toggle, multiple icon sets, and Auto/Light/Dark mode.
- Installable PWA with an offline service worker (`sw.js`).

## Run locally
The page uses ES modules, so Chrome/Edge block it over the `file://` scheme —
serve it over HTTP instead (no build step; any static server works):

```
python -m http.server 8099   # then open http://localhost:8099
```

(or `npx serve`). This matches how nginx serves it in production. Firefox can
open `index.html` directly, but a local server is the reliable path.

## Develop
There is **no build step** — the files served in production are the source files.
Quality is enforced by two checks:

- `npm run typecheck` — type-checks the JS via `tsc --noEmit` with `checkJs`.
  Types live in JSDoc comments (no `.ts` files); the whole app passes `strict`,
  including `noImplicitAny`.
- `npm test` — runs the pure-helper tests in `weather.js` with Node's built-in
  test runner (no dependencies).

A tracked pre-commit hook runs both. Activate it once per clone:

```
git config core.hooksPath .githooks
```

CI (`.github/workflows/check.yml`) runs the same two checks on every push and PR,
so the gate holds even where the local hook isn't activated.

### Layout
- `index.html` / `styles.css` — shell and styling.
- `weather.js` — pure data/format helpers (fully typed; covered by tests).
- `app.js` — DOM rendering, fetch, and app state.
- `radar.js` — Leaflet + RainViewer radar overlay (dynamically imported).
- `sw.js` — service worker. `types/globals.d.ts` — ambient globals (Leaflet).

## Deploy (otter cluster)
Files are served by nginx from a Kustomize-generated ConfigMap; Flux pulls this
repo directly.
1. Edit the source files. New files served to the browser must also be added to
   `configMapGenerator` in `kustomization.yaml`.
2. `git push` to `main`
3. Reconcile:
   `ssh otter 'sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl annotate gitrepository/weather -n flux-system reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite'`

Served at http://192.168.68.89:30095
