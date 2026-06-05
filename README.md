# Weather

A clean, client-side weather forecast page. Data from Open-Meteo (no API key).

## Run locally
Open `index.html` directly in a browser. No build step.

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
