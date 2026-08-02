import { GLCell } from '../scopes/GLCell.js';
import { PRESETS, cellCount } from './LayoutStore.js';
import { getScope, groupedScopes } from '../scopes/registry.js';

/**
 * Owns the grid of GLCells and keeps it in step with the LayoutStore.
 *
 * Cells are pooled up to the largest preset and never destroyed, because each
 * one holds a WebGL2 context — see the note in GLCell.
 */
export class ScopeGrid {
  constructor(container, store, { onScopePicked } = {}) {
    this.container = container;
    this.store = store;
    this.onScopePicked = onScopePicked;
    this.cells = [];
    this._smoothing = 'medium';

    this._ro = new ResizeObserver((entries) => {
      const dpr = window.devicePixelRatio || 1;
      for (const entry of entries) {
        const cell = entry.target._glCell;
        if (!cell) continue;
        const { width, height } = entry.contentRect;
        cell.resize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
      }
    });

    store.subscribe(() => this.apply());
    this.apply();
  }

  setSmoothing(level) {
    this._smoothing = level;
    for (const cell of this.cells) {
      if (cell.scope && cell.scope.setSmoothing) cell.scope.setSmoothing(level);
    }
  }

  /** Rebuild the grid from the current store state. */
  apply() {
    const { preset, cells: assignments } = this.store.state;
    const p = PRESETS[preset];
    const n = cellCount(preset);

    this.container.style.gridTemplateColumns = p.cols;
    this.container.style.gridTemplateRows = p.rows;

    while (this.cells.length < n) this._addCell(this.cells.length);

    this.cells.forEach((cell, i) => {
      const active = i < n;
      cell.el.classList.toggle('hidden', !active);
      if (!active) {
        if (cell.scope) cell.setScope(null, 'empty', '');
        return;
      }
      cell.el.style.gridArea = p.areas[i];
      this._assign(cell, assignments[i]);
    });
  }

  /** Scope instances for the visible cells, paired with their registry entry. */
  activeCells() {
    const n = cellCount(this.store.preset);
    return this.cells.slice(0, n).filter((c) => c.scope);
  }

  _addCell(index) {
    const cell = new GLCell(index);
    cell.el._glCell = cell;
    cell.label.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openPicker(cell);
    });
    this.container.appendChild(cell.el);
    this._ro.observe(cell.el);
    this.cells.push(cell);
  }

  _assign(cell, scopeId) {
    if (cell.scopeId === scopeId) return;
    const entry = getScope(scopeId);
    const scope = entry.create(cell);
    if (scope && scope.setSmoothing) scope.setSmoothing(this._smoothing);
    cell.setScope(scope, entry.id, entry.label);
    if (!scope) cell.clear();
  }

  _openPicker(cell) {
    closePicker();

    const menu = document.createElement('div');
    menu.className = 'scope-picker';

    for (const [group, entries] of groupedScopes()) {
      const heading = document.createElement('div');
      heading.className = 'scope-picker-group';
      heading.textContent = group;
      menu.appendChild(heading);

      for (const entry of entries) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'scope-picker-item';
        item.classList.toggle('active', entry.id === cell.scopeId);
        item.textContent = entry.label;
        item.addEventListener('click', () => {
          closePicker();
          this.store.setCell(cell.index, entry.id);
          if (this.onScopePicked) this.onScopePicked();
        });
        menu.appendChild(item);
      }
    }

    cell.el.appendChild(menu);
    activePicker = menu;
    // Defer so this click doesn't immediately close the menu it just opened
    setTimeout(() => document.addEventListener('click', closePicker, { once: true }), 0);
  }
}

let activePicker = null;

function closePicker() {
  if (activePicker) {
    activePicker.remove();
    activePicker = null;
  }
}
