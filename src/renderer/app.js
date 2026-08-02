import { Toolbar } from './ui/Toolbar.js';
import { CaptureEngine } from './capture/CaptureEngine.js';
import { LayoutStore, PRESETS, DEFAULT_LAYOUT } from './layout/LayoutStore.js';
import { ScopeGrid } from './layout/ScopeGrid.js';
import { getScope, analysesFor } from './scopes/registry.js';

// ── Platform class on body (drives CSS show/hide) ─────────
const platform = window.screenScope.platform();
document.body.classList.add(platform);

const emptyState = document.getElementById('empty-state');
const emptyHint  = document.getElementById('empty-hint');
const scopeArea  = document.getElementById('scope-area');

// ── Persisted settings ────────────────────────────────────
const settings = await window.screenScope.getSettings();
let smoothing = settings.smoothing || 'medium';

// ── Layout ────────────────────────────────────────────────
const store = new LayoutStore(settings.layout || DEFAULT_LAYOUT);
const grid = new ScopeGrid(scopeArea, store);
grid.setSmoothing(smoothing);

const presetList = Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label }));

function publishLayout() {
  window.screenScope.notifyLayout({
    preset: store.preset,
    presets: presetList,
    smoothing,
  });
  window.screenScope.setSettings({ layout: store.state, smoothing });
}

// Only the analyses some visible scope actually asked for get computed
function syncWorkerAnalyses() {
  worker.postMessage({ type: 'set-enabled', enabled: analysesFor(store.cells) });
}

store.subscribe(() => {
  syncWorkerAnalyses();
  publishLayout();
  if (platform === 'darwin') toolbar.setPreset(store.preset);
});

function setSmoothing(level) {
  smoothing = level;
  grid.setSmoothing(level);
  publishLayout();
  if (platform === 'darwin') toolbar.setSmoothing(level);
}

// ── Worker ────────────────────────────────────────────────
const worker = new Worker(
  new URL('../worker/analyzer.worker.js', import.meta.url),
  { type: 'module' }
);

let pendingFrame = false;
let frameCount = 0;

worker.onmessage = ({ data }) => {
  for (const cell of grid.activeCells()) {
    getScope(cell.scopeId).draw(cell.scope, data);
  }
  frameCount++;
  pendingFrame = false;
};

syncWorkerAnalyses();

// ── Capture engine ────────────────────────────────────────
const engine = new CaptureEngine({
  targetFps: 24,
  onFrame: ({ buffer, width, height }) => {
    if (pendingFrame) return;
    pendingFrame = true;
    worker.postMessage({ buffer, width, height }, [buffer]);
  },
});

// ── FPS readout ───────────────────────────────────────────
function startFpsTimer(show) {
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = (frameCount / ((now - lastTick) / 1000)).toFixed(0);
    show(fps, frameCount > 0);
    frameCount = 0;
    lastTick = now;
  }, 1000);
}

// ── macOS: HTML toolbar ───────────────────────────────────
let toolbar = null;

if (platform === 'darwin') {
  toolbar = new Toolbar(document.getElementById('toolbar'));
  toolbar.setPreset(store.preset);
  toolbar.setSmoothing(smoothing);
  toolbar.setAlwaysOnTop(settings.alwaysOnTop);

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

  toolbar.onPresetChange((preset) => store.setPreset(preset));
  toolbar.onSmoothingChange(setSmoothing);

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

  startFpsTimer((fps, active) => toolbar.setFps(fps, active));

// ── Windows/Linux: native menu + status bar ───────────────
} else {
  emptyHint.textContent = 'Select a source via the Sources menu to begin';

  const statusRegionInfo = document.getElementById('status-region-info');
  const statusFpsDisplay = document.getElementById('status-fps-display');

  startFpsTimer((fps, active) => {
    statusFpsDisplay.textContent = `${fps} fps`;
    statusFpsDisplay.classList.toggle('active', active);
  });

  window.screenScope.onMenuAction(async (action) => {
    if (action.type === 'source-selected') {
      emptyState.classList.remove('hidden');
      engine.cropRegion = null;
      statusRegionInfo.textContent = '';
      await engine.start(action.sourceId);
      emptyState.classList.add('hidden');

    } else if (action.type === 'set-preset') {
      store.setPreset(action.preset);

    } else if (action.type === 'set-smoothing') {
      setSmoothing(action.level);
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

// Seed main's menu mirror with the restored layout
publishLayout();
