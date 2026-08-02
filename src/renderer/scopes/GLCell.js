/**
 * One grid cell: its DOM, and — importantly — its WebGL2 context.
 *
 * The context is created once and outlives whatever scope is currently
 * assigned to the cell. Browsers cap concurrent WebGL contexts (~16), so
 * creating a fresh one on every scope reassignment would quietly start
 * dropping the oldest ones after a few dozen changes.
 */
export class GLCell {
  constructor(index) {
    this.index = index;

    this.el = document.createElement('div');
    this.el.className = 'scope-cell';

    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);

    // Graticule host — only the vectorscope uses it, but keeping it on every
    // cell means reassigning a scope never has to touch the DOM structure.
    this.overlay = document.createElement('div');
    this.overlay.className = 'graticule';
    this.el.appendChild(this.overlay);

    this.label = document.createElement('button');
    this.label.className = 'scope-label';
    this.label.type = 'button';
    this.el.appendChild(this.label);

    this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');

    this.scope = null;
    // Deliberately not 'empty' — the first assignment must always run so the
    // label gets its text, otherwise an empty cell has nothing to click.
    this.scopeId = null;
  }

  /** Swap in a new scope, tearing down the previous one's GL resources. */
  setScope(scope, scopeId, label) {
    if (this.scope && this.scope.destroy) this.scope.destroy();
    this.scope = scope;
    this.scopeId = scopeId;
    this.label.textContent = label;
    // Don't clear the overlay here — the incoming scope has already built its
    // graticule by this point. Scopes that use the overlay clear it in destroy().
    this.el.classList.toggle('is-empty', !scope);
    if (scope) this._applySize();
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
    this._applySize();
  }

  _applySize() {
    if (!this._w || !this._h) return;
    if (this.scope) this.scope.resize(this._w, this._h);
    else { this.canvas.width = this._w; this.canvas.height = this._h; }
  }

  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
