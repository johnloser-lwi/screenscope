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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;
let selectorWindow = null;

// ── Menu state ────────────────────────────────────────────
let activeSourceId = null;
const scopeVisibility = { vectorscope: true, rgb: true, luma: true };
let alwaysOnTop = false;

async function buildMenu() {
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
            if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
          },
        },
        { type: 'separator' },
        {
          label: 'Vectorscope',
          type: 'checkbox',
          checked: scopeVisibility.vectorscope,
          click: (item) => {
            scopeVisibility.vectorscope = item.checked;
            if (mainWindow) mainWindow.webContents.send('menu-action', {
              type: 'scope-toggle', scope: 'vectorscope-section', visible: item.checked,
            });
          },
        },
        {
          label: 'RGB Waveform',
          type: 'checkbox',
          checked: scopeVisibility.rgb,
          click: (item) => {
            scopeVisibility.rgb = item.checked;
            if (mainWindow) mainWindow.webContents.send('menu-action', {
              type: 'scope-toggle', scope: 'waveform-rgb', visible: item.checked,
            });
          },
        },
        {
          label: 'Luma Waveform',
          type: 'checkbox',
          checked: scopeVisibility.luma,
          click: (item) => {
            scopeVisibility.luma = item.checked;
            if (mainWindow) mainWindow.webContents.send('menu-action', {
              type: 'scope-toggle', scope: 'waveform-luma', visible: item.checked,
            });
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
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
    });
  } else {
    template.push({ label: 'App', submenu: [{ role: 'quit' }] });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 300,
    minHeight: 200,
    backgroundColor: '#0e0e0e',
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
  if (mainWindow) mainWindow.setAlwaysOnTop(flag);
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
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
