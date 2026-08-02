const {
  app,
  Menu,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  systemPreferences,
} = require('electron');
const path = require('path');
const { getSources } = require('./captureManager');
const settings = require('./settings');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;
let selectorWindow = null;

// ── Menu state ────────────────────────────────────────────
// The renderer's LayoutStore is authoritative; this is only a mirror so the
// native menu can show the right radio checkmarks. It arrives via
// 'layout-changed', which also carries the preset list so the menu never has
// to duplicate the renderer's layout definitions.
let activeSourceId = null;
let layoutState = { preset: null, presets: [], smoothing: 'medium' };
let alwaysOnTop = false;

const SMOOTHING_LEVELS = [
  { id: 'off',    label: 'Off' },
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
];

function send(action) {
  if (mainWindow) mainWindow.webContents.send('menu-action', action);
}

async function buildMenu() {
  // macOS uses the HTML toolbar — just set the standard app menu
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }]));
    return;
  }

  let sources = [];
  try { sources = await getSources(); } catch (_) { /* ignore */ }

  const sourceItems = sources.map(s => ({
    label: s.name,
    type: 'radio',
    checked: s.id === activeSourceId,
    click: () => {
      activeSourceId = s.id;
      if (mainWindow) mainWindow.webContents.send('menu-action', { type: 'source-selected', sourceId: s.id });
      buildMenu(); // rebuild to update radio checkmark
    },
  }));

  const template = [
    {
      label: 'Sources',
      submenu: [
        ...(sourceItems.length
          ? sourceItems
          : [{ label: 'No sources found', enabled: false }]),
        { type: 'separator' },
        { label: 'Refresh Sources', click: () => buildMenu() },
        { type: 'separator' },
        {
          label: 'Select Region',
          enabled: !!activeSourceId,
          click: () => {
            if (activeSourceId) createSelectorWindow(activeSourceId);
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: alwaysOnTop,
          click: (item) => {
            alwaysOnTop = item.checked;
            settings.write({ alwaysOnTop });
            if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
          },
        },
        { type: 'separator' },
        {
          label: 'Layout',
          submenu: layoutState.presets.map((p) => ({
            label: p.label,
            type: 'radio',
            checked: p.id === layoutState.preset,
            click: () => send({ type: 'set-preset', preset: p.id }),
          })),
        },
        {
          label: 'Smoothing',
          submenu: SMOOTHING_LEVELS.map((s) => ({
            label: s.label,
            type: 'radio',
            checked: s.id === layoutState.smoothing,
            click: () => send({ type: 'set-smoothing', level: s.id }),
          })),
        },
        { type: 'separator' },
        {
          label: 'Assign a scope to a cell by clicking its label',
          enabled: false,
        },
      ],
    },
  ];

  template.push({ label: 'App', submenu: [{ role: 'quit' }] });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 300,
    minHeight: 200,
    backgroundColor: '#0e0e0e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

async function checkScreenRecordingPermission() {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status !== 'granted') {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Screen Recording Permission Required',
      message:
        'ScreenScope needs Screen Recording access to capture your screen.',
      detail:
        'Open System Settings → Privacy & Security → Screen Recording, then enable ScreenScope.',
      buttons: ['Open System Settings', 'Later'],
      defaultId: 0,
    });
    if (response === 0) {
      require('electron').shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
    }
  }
}

function createSelectorWindow(sourceId) {
  if (selectorWindow) {
    selectorWindow.close();
    selectorWindow = null;
  }

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  selectorWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--source-id=${sourceId}`],
    },
  });

  if (process.platform === 'darwin') {
    selectorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (isDev) {
    selectorWindow.loadURL('http://localhost:5173/region-selector.html');
  } else {
    selectorWindow.loadFile(
      path.join(__dirname, '../../dist/renderer/region-selector.html')
    );
  }

  selectorWindow.on('closed', () => {
    selectorWindow = null;
  });
}

// IPC handlers
ipcMain.handle('get-sources', () => getSources());
ipcMain.on('refresh-sources', () => buildMenu());

ipcMain.on('set-always-on-top', (_event, flag) => {
  alwaysOnTop = flag;
  settings.write({ alwaysOnTop });
  if (mainWindow) mainWindow.setAlwaysOnTop(flag);
});

ipcMain.handle('get-settings', () => settings.read());

ipcMain.on('set-settings', (_event, partial) => settings.write(partial));

ipcMain.on('layout-changed', (_event, state) => {
  layoutState = { ...layoutState, ...state };
  if (process.platform !== 'darwin') buildMenu();
});

ipcMain.handle('start-region-select', (_event, sourceId) => {
  createSelectorWindow(sourceId);
});

ipcMain.on('region-confirmed', (_event, region) => {
  if (selectorWindow) {
    selectorWindow.close();
    selectorWindow = null;
  }
  if (mainWindow) {
    mainWindow.webContents.send('region-selected', region);
  }
});

ipcMain.on('region-cancelled', () => {
  if (selectorWindow) {
    selectorWindow.close();
    selectorWindow = null;
  }
});

app.whenReady().then(async () => {
  await checkScreenRecordingPermission();
  alwaysOnTop = settings.read().alwaysOnTop;
  createMainWindow();
  if (alwaysOnTop && mainWindow) mainWindow.setAlwaysOnTop(true);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => settings.flush());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
