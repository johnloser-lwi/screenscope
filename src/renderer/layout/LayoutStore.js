/**
 * The layout model, and the single source of truth for what is on screen.
 *
 * Both control surfaces (the macOS HTML toolbar and the Windows/Linux native
 * menu) drive this one store, which is what keeps them in sync — previously
 * each platform tracked visibility separately and they could disagree.
 */

// grid-area values are explicit row/column line numbers, so spanning presets
// need no named template.
export const PRESETS = {
  '1':       { label: 'Single',        cols: '1fr',           rows: '1fr',     areas: ['1/1/2/2'] },
  '2h':      { label: '2 Across',      cols: '1fr 1fr',       rows: '1fr',     areas: ['1/1/2/2', '1/2/2/3'] },
  '2v':      { label: '2 Stacked',     cols: '1fr',           rows: '1fr 1fr', areas: ['1/1/2/2', '2/1/3/2'] },
  '3-top':   { label: '1 Top + 2',     cols: '1fr 1fr',       rows: '1fr 1fr', areas: ['1/1/2/3', '2/1/3/2', '2/2/3/3'] },
  '3-left':  { label: '1 Left + 2',    cols: '1fr 1fr',       rows: '1fr 1fr', areas: ['1/1/3/2', '1/2/2/3', '2/2/3/3'] },
  '4':       { label: '2 × 2',         cols: '1fr 1fr',       rows: '1fr 1fr', areas: ['1/1/2/2', '1/2/2/3', '2/1/3/2', '2/2/3/3'] },
  '6':       { label: '3 × 2',         cols: 'repeat(3, 1fr)', rows: '1fr 1fr', areas: ['1/1/2/2', '1/2/2/3', '1/3/2/4', '2/1/3/2', '2/2/3/3', '2/3/3/4'] },
};

export const DEFAULT_LAYOUT = {
  preset: '3-top',
  // Matches the arrangement the app shipped with
  cells: ['vectorscope', 'waveform-rgb-parade', 'waveform-luma'],
};

export function cellCount(preset) {
  return (PRESETS[preset] || PRESETS['3-top']).areas.length;
}

export class LayoutStore {
  constructor(initial) {
    this._listeners = new Set();
    this.state = this._normalise(initial || DEFAULT_LAYOUT);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  get preset() { return this.state.preset; }
  get cells() { return this.state.cells; }

  setPreset(preset) {
    if (!PRESETS[preset] || preset === this.state.preset) return;
    // Keep assignments by index so switching presets doesn't wipe the setup
    this.state = this._normalise({ preset, cells: this.state.cells });
    this._emit();
  }

  setCell(index, scopeId) {
    if (this.state.cells[index] === scopeId) return;
    const cells = this.state.cells.slice();
    cells[index] = scopeId;
    this.state = { ...this.state, cells };
    this._emit();
  }

  _normalise({ preset, cells }) {
    const p = PRESETS[preset] ? preset : DEFAULT_LAYOUT.preset;
    const n = cellCount(p);
    const next = (cells || []).slice(0, n);
    while (next.length < n) next.push('empty');
    return { preset: p, cells: next };
  }

  _emit() {
    for (const fn of this._listeners) fn(this.state);
  }
}
