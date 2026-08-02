import { VectorscopeScope } from './VectorscopeScope.js';
import { WaveformScope } from './WaveformScope.js';
import { WaveformRGBScope } from './WaveformRGBScope.js';
import { HistogramScope } from './HistogramScope.js';

/**
 * Every scope the app can put in a cell.
 *
 * Single source of truth for three consumers: the cell factory, the per-cell
 * picker UI, and the worker's enable-set (`needs`) — so a scope nobody is
 * showing costs no CPU.
 *
 *   needs   which worker analyses this scope requires
 *   create  build an instance against a cell's persistent GL context
 *   draw    hand the instance the arrays it asked for
 */
export const SCOPES = [
  {
    id: 'vectorscope',
    label: 'Vectorscope',
    group: 'Vectorscope',
    needs: ['vector'],
    create: (cell) => new VectorscopeScope(cell),
    draw: (s, d) => d.vectorData && s.render(d.vectorData),
  },
  {
    id: 'vectorscope-2x',
    label: 'Vectorscope (2×)',
    group: 'Vectorscope',
    needs: ['vector'],
    create: (cell) => new VectorscopeScope(cell, { zoom: 2 }),
    draw: (s, d) => d.vectorData && s.render(d.vectorData),
  },
  {
    id: 'vectorscope-4x',
    label: 'Vectorscope (4×)',
    group: 'Vectorscope',
    needs: ['vector'],
    create: (cell) => new VectorscopeScope(cell, { zoom: 4 }),
    draw: (s, d) => d.vectorData && s.render(d.vectorData),
  },

  {
    id: 'waveform-luma',
    label: 'Waveform — Luma',
    group: 'Waveform',
    needs: ['luma'],
    create: (cell) => new WaveformScope(cell),
    draw: (s, d) => d.lumaData && s.render(d.lumaData, d.width),
  },
  {
    id: 'waveform-luma-shadows',
    label: 'Waveform — Luma (Shadows 0–20)',
    group: 'Waveform',
    needs: ['luma'],
    create: (cell) => new WaveformScope(cell, { range: [0, 0.2] }),
    draw: (s, d) => d.lumaData && s.render(d.lumaData, d.width),
  },
  {
    id: 'waveform-luma-highlights',
    label: 'Waveform — Luma (Highlights 80–100)',
    group: 'Waveform',
    needs: ['luma'],
    create: (cell) => new WaveformScope(cell, { range: [0.8, 1] }),
    draw: (s, d) => d.lumaData && s.render(d.lumaData, d.width),
  },

  {
    id: 'waveform-rgb-parade',
    label: 'Waveform — RGB Parade',
    group: 'Waveform',
    needs: ['rgb'],
    create: (cell) => new WaveformRGBScope(cell, { mode: 'parade' }),
    draw: (s, d) => d.rData && s.render(d.rData, d.gData, d.bData, d.width),
  },
  {
    id: 'waveform-rgb-overlay',
    label: 'Waveform — RGB Overlay',
    group: 'Waveform',
    needs: ['rgb'],
    create: (cell) => new WaveformRGBScope(cell, { mode: 'overlay' }),
    draw: (s, d) => d.rData && s.render(d.rData, d.gData, d.bData, d.width),
  },
  {
    id: 'waveform-rgb-shadows',
    label: 'Waveform — RGB Parade (Shadows 0–20)',
    group: 'Waveform',
    needs: ['rgb'],
    create: (cell) => new WaveformRGBScope(cell, { mode: 'parade', range: [0, 0.2] }),
    draw: (s, d) => d.rData && s.render(d.rData, d.gData, d.bData, d.width),
  },

  {
    id: 'histogram-rgb',
    label: 'Histogram — RGB',
    group: 'Histogram',
    needs: ['histogram'],
    create: (cell) => new HistogramScope(cell, { mode: 'rgb' }),
    draw: (s, d) => d.histogramData && s.render(d.histogramData),
  },
  {
    id: 'histogram-parade',
    label: 'Histogram — Parade',
    group: 'Histogram',
    needs: ['histogram'],
    create: (cell) => new HistogramScope(cell, { mode: 'parade' }),
    draw: (s, d) => d.histogramData && s.render(d.histogramData),
  },
  {
    id: 'histogram-luma',
    label: 'Histogram — Luma',
    group: 'Histogram',
    needs: ['histogram'],
    create: (cell) => new HistogramScope(cell, { mode: 'luma' }),
    draw: (s, d) => d.histogramData && s.render(d.histogramData),
  },

  {
    id: 'empty',
    label: 'Empty',
    group: 'Other',
    needs: [],
    create: () => null,
    draw: () => {},
  },
];

const BY_ID = new Map(SCOPES.map((s) => [s.id, s]));

export function getScope(id) {
  return BY_ID.get(id) || BY_ID.get('empty');
}

/** Group entries in registry order, for building the picker menu. */
export function groupedScopes() {
  const groups = new Map();
  for (const s of SCOPES) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }
  return groups;
}

/** Union of the analyses the given scope ids require. */
export function analysesFor(ids) {
  const enabled = { luma: false, rgb: false, vector: false, histogram: false };
  for (const id of ids) {
    for (const need of getScope(id).needs) enabled[need] = true;
  }
  return enabled;
}
