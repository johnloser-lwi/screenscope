import { CaptureEngine } from './capture/CaptureEngine.js';
import { VectorscopeScope } from './scopes/VectorscopeScope.js';
import { WaveformScope } from './scopes/WaveformScope.js';
import { WaveformRGBScope } from './scopes/WaveformRGBScope.js';

// ── DOM refs ──────────────────────────────────────────────
const emptyState  = document.getElementById('empty-state');
const canvasVec   = document.getElementById('canvas-vectorscope');
const graticule   = document.getElementById('graticule');
const canvasRGB   = document.getElementById('canvas-waveform-rgb');
const canvasLuma  = document.getElementById('canvas-waveform-luma');
const regionInfo  = document.getElementById('region-info');
const fpsDisplay  = document.getElementById('fps-display');

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

// ── FPS counter ───────────────────────────────────────────
let frameCount = 0;
let lastFpsTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const elapsed = (now - lastFpsTick) / 1000;
  const fps = (frameCount / elapsed).toFixed(0);
  fpsDisplay.textContent = `${fps} fps`;
  fpsDisplay.classList.toggle('active', frameCount > 0);
  frameCount = 0;
  lastFpsTick = now;
}, 1000);

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
  frameCount++;
  pendingFrame = false;
};

// ── Capture engine ────────────────────────────────────────
const engine = new CaptureEngine({
  targetFps: 24,
  onFrame: ({ buffer, width, height }) => {
    if (pendingFrame) return;
    pendingFrame = true;
    worker.postMessage({ buffer, width, height }, [buffer]);
  },
});

// ── Scope visibility helpers ──────────────────────────────
function updateWaveformLayout() {
  const rgbVisible  = !document.getElementById('waveform-rgb').classList.contains('hidden');
  const lumaVisible = !document.getElementById('waveform-luma').classList.contains('hidden');
  const row = document.getElementById('waveform-row');
  row.classList.toggle('hidden', !rgbVisible && !lumaVisible);
}

// ── Menu action handler (IPC from main process) ───────────
window.screenScope.onMenuAction(async (action) => {
  if (action.type === 'source-selected') {
    emptyState.classList.remove('hidden');
    engine.cropRegion = null;
    regionInfo.textContent = '';
    await engine.start(action.sourceId);
    emptyState.classList.add('hidden');

  } else if (action.type === 'scope-toggle') {
    const section = document.getElementById(action.scope);
    if (section) {
      section.classList.toggle('hidden', !action.visible);
      updateWaveformLayout();
    }
  }
});

// ── Region selection result ───────────────────────────────
window.screenScope.onRegionSelected((region) => {
  engine.setRegion(region);

  const sw = engine.sourceSize.width;
  const sh = engine.sourceSize.height;
  regionInfo.textContent =
    `${Math.round(region.width * sw)}×${Math.round(region.height * sh)}` +
    ` @ (${Math.round(region.x * sw)}, ${Math.round(region.y * sh)})`;
});
