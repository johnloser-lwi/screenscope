const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Plain fs rather than electron-store — the project has no runtime
// dependencies and this is a single flat object.
const FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  layout: null,        // { preset, cells } — null means use the renderer default
  smoothing: 'medium',
  alwaysOnTop: false,
};

let cache = null;
let writeTimer = null;

function read() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch (_) {
    // Missing or corrupt file — fall back to defaults rather than failing to start
    cache = { ...DEFAULTS };
  }
  return cache;
}

function write(partial) {
  cache = { ...read(), ...partial };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error('Failed to write settings:', err);
    }
  }, 500);
  return cache;
}

function flush() {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Failed to write settings:', err);
  }
}

module.exports = { read, write, flush };
