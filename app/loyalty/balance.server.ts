// Balance display helper. The DB is authoritative; the storefront widget reads
// the authoritative value via App Proxy (see routes/proxy.state.tsx). The true
// balance can go negative after a clawback, so what a member SEES is floored at 0.

export function displayBalance(balance: number): number {
  return Math.max(0, balance);
}
