export class Toolbar {
  constructor(el) {
    this.el = el;
    this._onSourceChange = null;
    this._onSelectRegion = null;

    this._sourceSelect  = el.querySelector('#source-select');
    this._btnRefresh    = el.querySelector('#btn-refresh');
    this._btnRegion     = el.querySelector('#btn-select-region');
    this._regionInfo    = el.querySelector('#region-info');
    this._fpsDisplay    = el.querySelector('#fps-display');
    this._chkAlwaysOnTop = el.querySelector('#chk-always-on-top');

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

    this.loadSources();
    this._startFpsTimer();
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

  onSourceChange(fn)  { this._onSourceChange  = fn; }
  onSelectRegion(fn)  { this._onSelectRegion  = fn; }

  setRegionInfo(region) {
    if (!region) {
      this._regionInfo.textContent = '';
      return;
    }
    this._regionInfo.textContent =
      `${region.pixelWidth}×${region.pixelHeight} @ (${region.pixelX}, ${region.pixelY})`;
  }

  // FPS counter — updated externally
  _startFpsTimer() {
    this._frameCount = 0;
    this._lastFpsTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      const elapsed = (now - this._lastFpsTick) / 1000;
      const fps = (this._frameCount / elapsed).toFixed(0);
      this._fpsDisplay.textContent = `${fps} fps`;
      this._fpsDisplay.classList.toggle('active', this._frameCount > 0);
      this._frameCount = 0;
      this._lastFpsTick = now;
    }, 1000);
  }

  tickFrame() { this._frameCount++; }
}
