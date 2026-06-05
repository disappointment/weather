# Weather

A clean, client-side weather forecast page. Data from Open-Meteo (no API key).

## Run locally
The page uses ES modules, so Chrome/Edge block it over the `file://` scheme —
serve it over HTTP instead (no build step; any static server works):

```
python -m http.server 8099   # then open http://localhost:8099
```

(or `npx serve`). This matches how nginx serves it in production. Firefox can
open `index.html` directly, but a local server is the reliable path.

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
