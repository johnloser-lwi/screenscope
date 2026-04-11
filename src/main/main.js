const {
  app,
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

ipcMain.on('set-always-on-top', (_event, flag) => {
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
