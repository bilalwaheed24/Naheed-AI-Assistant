const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Window ──────────────────────────────────────────────
  win: {
    minimize: ()    => ipcRenderer.invoke('win:minimize'),
    close:    ()    => ipcRenderer.invoke('win:close'),
    pin:      (v)   => ipcRenderer.invoke('win:pin', v),
    getPin:   ()    => ipcRenderer.invoke('win:get-pin')
  },

  // ── Settings ─────────────────────────────────────────────
  settings: {
    load: ()    => ipcRenderer.invoke('settings:load'),
    save: (d)   => ipcRenderer.invoke('settings:save', d)
  },

  // ── Hardware ─────────────────────────────────────────────
  hw: {
    all:      ()       => ipcRenderer.invoke('hw:all'),
    printers: ()       => ipcRenderer.invoke('hw:printers'),
    scanners: ()       => ipcRenderer.invoke('hw:scanners'),
    network:  ()       => ipcRenderer.invoke('hw:network'),
    ecr:      (cfg)    => ipcRenderer.invoke('hw:ecr', cfg),
    services: ()       => ipcRenderer.invoke('hw:services'),
    sysinfo:  ()       => ipcRenderer.invoke('hw:sysinfo')
  },

  // ── AI ───────────────────────────────────────────────────
  ai: {
    chat: (d) => ipcRenderer.invoke('ai:chat', d)
  }
});
