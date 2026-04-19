/**
 * Electron main process. Loads the Vite dev server in dev (ELECTRON_DEV=1)
 * or the built dist/index.html in prod. Application menu is disabled so
 * F1, F5, Ctrl+P and the other Chromium shortcuts reach the web content
 * (e.g. F1 toggling the in-game dev overlay) instead of getting swallowed
 * by the browser chrome.
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

const isDev = process.env.ELECTRON_DEV === '1';
const devUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'March Mad',
    backgroundColor: '#101018',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();

  if (isDev) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

Menu.setApplicationMenu(null);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
