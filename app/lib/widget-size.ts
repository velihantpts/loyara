// REAL measured footprint of the storefront widget's shipped CSS+JS, from
// scripts/measure-widget.mjs. scripts/widget-size-test.ts re-measures on every
// `npm test` and fails if these drift beyond tolerance — so the dashboard speed
// card can never quietly show a stale or false number.
// Regenerate after changing the widget: node scripts/measure-widget.mjs
export const WIDGET_SIZE = {
  rawKB: 15.9,
  gzipKB: 4.7,
};
