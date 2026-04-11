import { Toolbar } from './ui/Toolbar.js';
import { CaptureEngine } from './capture/CaptureEngine.js';
import { VectorscopeScope } from './scopes/VectorscopeScope.js';
import { WaveformScope } from './scopes/WaveformScope.js';
import { WaveformRGBScope } from './scopes/WaveformRGBScope.js';

// ── DOM refs ──────────────────────────────────────────────
const toolbarEl   = document.getElementById('toolbar');
const emptyState  = document.getElementById('empty-state');
const canvasVec   = document.getElementById('canvas-vectorscope');
const graticule   = document.getElementById('graticule');
const canvasRGB   = document.getElementById('canvas-waveform-rgb');
const canvasLuma  = document.getElementById('canvas-waveform-luma');

// ── Scopes ────────────────────────────────────────────────
const scopeVec  = new VectorscopeScope(canvasVec, graticule);
const scopeLuma = new WaveformScope(canvasLuma);
const scopeRGB  = new WaveformRGBScope(canvasRGB);

// ── ResizeObserver — keep canvas pixels = CSS pixels ──────
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    const target = entry.target;
    if (target === canvasVec.parentElement)  scopeVec.resize(w, h);
    if (target === canvasLuma.parentElement) scopeLuma.resize(w, h);
    if (target === canvasRGB.parentElement)  scopeRGB.resize(w, h);
  }
});
ro.observe(canvasVec.parentElement);
ro.observe(canvasLuma.parentElement);
ro.observe(canvasRGB.parentElement);

// ── Scope toggles ─────────────────────────────────────────
function updateWaveformLayout() {
  const rgbVisible  = !document.getElementById('waveform-rgb').classList.contains('hidden');
  const lumaVisible = !document.getElementById('waveform-luma').classList.contains('hidden');
  const row = document.getElementById('waveform-row');
  row.classList.toggle('hidden', !rgbVisible && !lumaVisible);
}

document.querySelectorAll('.scope-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = document.getElementById(btn.dataset.target);
    const isHidden = section.classList.toggle('hidden');
    btn.classList.toggle('active', !isHidden);
    updateWaveformLayout();
  });
});

// ── Worker ────────────────────────────────────────────────
const worker = new Worker(
  new URL('../worker/analyzer.worker.js', import.meta.url),
  { type: 'module' }
);

let pendingFrame = false;

worker.onmessage = ({ data }) => {
  const { lumaData, rData, gData, bData, vectorData, width } = data;
  scopeVec.render(vectorData);
  scopeLuma.render(lumaData, width);
  scopeRGB.render(rData, gData, bData, width);
  toolbar.tickFrame();
  pendingFrame = false;
};

// ── Capture engine ────────────────────────────────────────
const engine = new CaptureEngine({
  targetFps: 24,
  onFrame: ({ buffer, width, height }) => {
    if (pendingFrame) return; // drop frame if worker still busy
    pendingFrame = true;
    worker.postMessage({ buffer, width, height }, [buffer]);
  },
});

// ── Toolbar ───────────────────────────────────────────────
const toolbar = new Toolbar(toolbarEl);

toolbar.onSourceChange(async (sourceId) => {
  if (!sourceId) { engine.stop(); return; }
  emptyState.classList.remove('hidden');
  engine.cropRegion = null;
  toolbar.setRegionInfo(null);
  await engine.start(sourceId);
  // Start capturing full frame until region is selected
  emptyState.classList.add('hidden');
});

toolbar.onSelectRegion((sourceId) => {
  if (!sourceId) return;
  window.screenScope.startRegionSelect(sourceId);
});

// ── Region selection result ───────────────────────────────
window.screenScope.onRegionSelected((region) => {
  // region is normalised 0..1
  engine.setRegion(region);

  const sw = engine.sourceSize.width;
  const sh = engine.sourceSize.height;
  toolbar.setRegionInfo({
    pixelX:     Math.round(region.x * sw),
    pixelY:     Math.round(region.y * sh),
    pixelWidth:  Math.round(region.width  * sw),
    pixelHeight: Math.round(region.height * sh),
  });
});
