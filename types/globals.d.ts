// Leaflet is loaded from a CDN <script> (no bundler), so it lives on window as a
// global rather than an import. radar.js reads it lazily via window.L. We type it
// loosely as `any` — typing the full Leaflet API isn't worth it for a thin overlay.
interface Window {
  L: any;
}
