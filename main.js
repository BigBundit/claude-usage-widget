const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const usage = require('./usage');

const STATE_FILE = path.join(app.getPath('userData'), 'widget-state.json');
let win = null;
let tray = null;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveState(patch) {
  const s = { ...loadState(), ...patch };
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (_) {}
}

function createWindow() {
  const state = loadState();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 210,
    height: 440,
    x: state.x != null ? state.x : sw - 235,
    y: state.y != null ? state.y : 40,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: state.alwaysOnTop !== false,
    skipTaskbar: true,
    hasShadow: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Pin firmly above normal windows; some apps knock plain alwaysOnTop off,
  // so use a higher z-level and re-assert it periodically.
  if (loadState().alwaysOnTop !== false) win.setAlwaysOnTop(true, 'screen-saver');
  setInterval(() => {
    if (win && !win.isDestroyed() && loadState().alwaysOnTop !== false && !win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 3000);

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    saveState({ x, y });
  });
}

function trayIcon() {
  try {
    return nativeImage
      .createFromPath(path.join(__dirname, 'build', 'icon.png'))
      .resize({ width: 16, height: 16 });
  } catch (_) { return nativeImage.createEmpty(); }
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Claude Usage Widget');
  const rebuild = () => {
    const state = loadState();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Refresh', click: () => win && win.webContents.send('refresh') },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: state.alwaysOnTop !== false,
          click: (item) => {
            saveState({ alwaysOnTop: item.checked });
            if (win) win.setAlwaysOnTop(item.checked, 'screen-saver');
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    );
  };
  rebuild();
  tray.on('click', () => { if (win) win.show(); });
}

ipcMain.handle('get-usage', async () => usage.getAll());
ipcMain.on('resize-height', (_e, h) => {
  if (win && Number.isFinite(h)) {
    const [w] = win.getSize();
    win.setSize(w, Math.max(200, Math.min(1000, Math.round(h))));
  }
});
ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => app.quit());
