import { Toolbar } from './ui/Toolbar.js';
import { CaptureEngine } from './capture/CaptureEngine.js';
import { VectorscopeScope } from './scopes/VectorscopeScope.js';
import { WaveformScope } from './scopes/WaveformScope.js';
import { WaveformRGBScope } from './scopes/WaveformRGBScope.js';

// ── Platform class on body (drives CSS show/hide) ─────────
const platform = window.screenScope.platform();
document.body.classList.add(platform);

// ── DOM refs ──────────────────────────────────────────────
const emptyState  = document.getElementById('empty-state');
const emptyHint   = document.getElementById('empty-hint');
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

// ── Worker ────────────────────────────────────────────────
const worker = new Worker(
  new URL('../worker/analyzer.worker.js', import.meta.url),
  { type: 'module' }
);

let pendingFrame = false;
let frameCount = 0;

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
  document.getElementById('waveform-row').classList.toggle('hidden', !rgbVisible && !lumaVisible);
}

// ── macOS: HTML toolbar ───────────────────────────────────
if (platform === 'darwin') {
  const toolbar = new Toolbar(document.getElementById('toolbar'));

  toolbar.onSourceChange(async (sourceId) => {
    if (!sourceId) { engine.stop(); return; }
    emptyState.classList.remove('hidden');
    engine.cropRegion = null;
    toolbar.setRegionInfo(null);
    await engine.start(sourceId);
    emptyState.classList.add('hidden');
  });

  toolbar.onSelectRegion((sourceId) => {
    if (!sourceId) return;
    window.screenScope.startRegionSelect(sourceId);
  });

  window.screenScope.onRegionSelected((region) => {
    engine.setRegion(region);
    const sw = engine.sourceSize.width;
    const sh = engine.sourceSize.height;
    toolbar.setRegionInfo({
      pixelX:      Math.round(region.x * sw),
      pixelY:      Math.round(region.y * sh),
      pixelWidth:  Math.round(region.width  * sw),
      pixelHeight: Math.round(region.height * sh),
    });
  });

  // Scope toggle buttons in HTML toolbar
  document.querySelectorAll('.scope-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = document.getElementById(btn.dataset.target);
      const isHidden = section.classList.toggle('hidden');
      btn.classList.toggle('active', !isHidden);
      updateWaveformLayout();
    });
  });

  // FPS display is in the toolbar on macOS
  let lastFpsTick = performance.now();
  const fpsDisplay = document.getElementById('fps-display');
  setInterval(() => {
    const now = performance.now();
    const elapsed = (now - lastFpsTick) / 1000;
    const fps = (frameCount / elapsed).toFixed(0);
    fpsDisplay.textContent = `${fps} fps`;
    fpsDisplay.classList.toggle('active', frameCount > 0);
    frameCount = 0;
    lastFpsTick = now;
  }, 1000);

// ── Windows/Linux: native menu + status bar ───────────────
} else {
  emptyHint.textContent = 'Select a source via the Sources menu to begin';

  const statusRegionInfo  = document.getElementById('status-region-info');
  const statusFpsDisplay  = document.getElementById('status-fps-display');

  let lastFpsTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const elapsed = (now - lastFpsTick) / 1000;
    const fps = (frameCount / elapsed).toFixed(0);
    statusFpsDisplay.textContent = `${fps} fps`;
    statusFpsDisplay.classList.toggle('active', frameCount > 0);
    frameCount = 0;
    lastFpsTick = now;
  }, 1000);

  window.screenScope.onMenuAction(async (action) => {
    if (action.type === 'source-selected') {
      emptyState.classList.remove('hidden');
      engine.cropRegion = null;
      statusRegionInfo.textContent = '';
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

  window.screenScope.onRegionSelected((region) => {
    engine.setRegion(region);
    const sw = engine.sourceSize.width;
    const sh = engine.sourceSize.height;
    statusRegionInfo.textContent =
      `${Math.round(region.width * sw)}×${Math.round(region.height * sh)}` +
      ` @ (${Math.round(region.x * sw)}, ${Math.round(region.y * sh)})`;
  });
}
