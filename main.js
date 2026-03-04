const { app, BrowserWindow, ipcMain, shell, Menu, Tray } = require('electron');
const path = require('path');
const fs   = require('fs');

// ─── Settings helpers ───────────────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'naheed-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_) {}
  return {
    apiKey:   '',
    ecrHost:  '192.168.1.100',
    ecrPort:  4000,
    pinned:   true,
    autoScan: false,
    scanInterval: 60,
    cashierName: '',
    storeId: ''
  };
}

function saveSettings(data) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
}

// ─── Window ─────────────────────────────────────────────────────────────────
let mainWindow;
let isAlwaysOnTop = true;

function createWindow() {
  const settings = loadSettings();
  isAlwaysOnTop  = settings.pinned !== false;

  mainWindow = new BrowserWindow({
    width:      420,
    height:     680,
    minWidth:   370,
    minHeight:  540,
    maxWidth:   640,
    maxHeight:  900,
    frame:      false,
    transparent: false,
    resizable:  true,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false
    },
    icon:            path.join(__dirname, 'assets', 'icon.png'),
    title:           'Naheed AI Assistant',
    backgroundColor: '#f5f7fa',
    show:            false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Remove default menu
  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── Window control IPC ──────────────────────────────────────────────────────
ipcMain.handle('win:minimize', () => mainWindow.minimize());
ipcMain.handle('win:close',    () => app.quit());
ipcMain.handle('win:pin',      (_, pin) => {
  isAlwaysOnTop = pin;
  mainWindow.setAlwaysOnTop(pin);
  return pin;
});
ipcMain.handle('win:get-pin',  () => isAlwaysOnTop);

// ─── Settings IPC ────────────────────────────────────────────────────────────
ipcMain.handle('settings:load', ()       => loadSettings());
ipcMain.handle('settings:save', (_, d)   => saveSettings(d));

// ─── Hardware diagnostics IPC ────────────────────────────────────────────────
const diag = require('./hardware/diagnostics');

ipcMain.handle('hw:all',      ()          => diag.checkAll());
ipcMain.handle('hw:printers', ()          => diag.checkPrinters());
ipcMain.handle('hw:scanners', ()          => diag.checkScanners());
ipcMain.handle('hw:network',  ()          => diag.checkNetwork());
ipcMain.handle('hw:ecr',      (_, cfg)    => diag.checkECR(cfg));
ipcMain.handle('hw:services', ()          => diag.checkServices());
ipcMain.handle('hw:sysinfo',  ()          => diag.getSystemInfo());

// ─── Gemini AI IPC ───────────────────────────────────────────────────────────
ipcMain.handle('ai:chat', async (_, { messages, apiKey, systemPrompt }) => {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'Gemini API key not set. Please add it in Settings.' };
  }
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI  = new GoogleGenerativeAI(apiKey.trim());
    const model  = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt
    });

    // Build history from all messages except the last one
    const history = messages.slice(0, -1).map(m => ({
      role:  m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const chat   = model.startChat({ history });
    const last   = messages[messages.length - 1];
    const result = await chat.sendMessage(last.content);
    return { ok: true, text: result.response.text() };
  } catch (err) {
    return { ok: false, error: err.message || 'AI request failed' };
  }
});
