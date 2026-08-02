import { PRESETS } from '../layout/LayoutStore.js';

export class Toolbar {
  constructor(el) {
    this.el = el;
    this._onSourceChange = null;
    this._onSelectRegion = null;
    this._onPresetChange = null;
    this._onSmoothingChange = null;

    this._sourceSelect    = el.querySelector('#source-select');
    this._btnRefresh      = el.querySelector('#btn-refresh');
    this._btnRegion       = el.querySelector('#btn-select-region');
    this._regionInfo      = el.querySelector('#region-info');
    this._fpsDisplay      = el.querySelector('#fps-display');
    this._chkAlwaysOnTop  = el.querySelector('#chk-always-on-top');
    this._layoutSelect    = el.querySelector('#layout-select');
    this._smoothingSelect = el.querySelector('#smoothing-select');

    for (const [id, p] of Object.entries(PRESETS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.label;
      this._layoutSelect.appendChild(opt);
    }

    this._sourceSelect.addEventListener('change', () => {
      this._onSourceChange?.(this._sourceSelect.value);
    });
    this._btnRefresh.addEventListener('click', () => this.loadSources());
    this._btnRegion.addEventListener('click', () => {
      this._onSelectRegion?.(this._sourceSelect.value);
    });
    this._chkAlwaysOnTop.addEventListener('change', () => {
      window.screenScope.setAlwaysOnTop(this._chkAlwaysOnTop.checked);
    });
    this._layoutSelect.addEventListener('change', () => {
      this._onPresetChange?.(this._layoutSelect.value);
    });
    this._smoothingSelect.addEventListener('change', () => {
      this._onSmoothingChange?.(this._smoothingSelect.value);
    });

    this.loadSources();
  }

  async loadSources() {
    const sources = await window.screenScope.getSources();
    this._sourceSelect.innerHTML = '<option value="">— Select source —</option>';
    for (const s of sources) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      this._sourceSelect.appendChild(opt);
    }
  }

  onSourceChange(fn) { this._onSourceChange = fn; }
  onSelectRegion(fn) { this._onSelectRegion = fn; }
  onPresetChange(fn) { this._onPresetChange = fn; }
  onSmoothingChange(fn) { this._onSmoothingChange = fn; }

  setPreset(preset) { this._layoutSelect.value = preset; }
  setSmoothing(level) { this._smoothingSelect.value = level; }
  setAlwaysOnTop(flag) { this._chkAlwaysOnTop.checked = !!flag; }

  setRegionInfo(region) {
    if (!region) { this._regionInfo.textContent = ''; return; }
    this._regionInfo.textContent =
      `${region.pixelWidth}×${region.pixelHeight} @ (${region.pixelX}, ${region.pixelY})`;
  }

  setFps(fps, active) {
    this._fpsDisplay.textContent = `${fps} fps`;
    this._fpsDisplay.classList.toggle('active', active);
  }
}
