/* ═══════════════════════════════════════════════════════════════════
   Naheed AI Assistant – Renderer / App Logic
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  view: 'dashboard',
  scanning: false,
  pinned: true,
  lastScan: null,
  hardware: {
    printers:  [],
    scanners:  [],
    network:   [],
    ecr:       [],
    services:  [],
    sysinfo:   {}
  },
  chat: {
    messages: [],
    loading:  false
  },
  settings: {
    apiKey:       '',
    ecrHost:      '192.168.1.100',
    ecrPort:      4000,
    pinned:       true,
    autoScan:     false,
    scanInterval: 60,
    cashierName:  '',
    storeId:      ''
  }
};

let autoScanTimer = null;

// ─── System prompt for Gemini ─────────────────────────────────────────────────

function buildSystemPrompt() {
  const si = state.hardware.sysinfo;
  const ctx = si.hostname ? `
CURRENT SYSTEM:
- Hostname: ${si.hostname}
- OS: ${si.osName || si.release}
- CPU: ${si.cpu} (${si.cores} cores)
- RAM: ${si.ramFree} free / ${si.ramTotal} total
- IP: ${si.localIp}
- Uptime: ${si.uptime}
` : '';

  return `You are an expert cashier system technician for Naheed Supermarket.
You diagnose and fix issues with POS hardware and software.

SCOPE: Receipt printers, barcode scanners, ECR/credit-card terminals,
network connectivity, Windows services, POS software errors.
${ctx}
STYLE: Be concise, numbered steps, plain language. No markdown headers.
If diagnosing, ask one clarifying question at a time.
If hardware scan data is pasted, analyze it and prioritize critical issues.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function el(id)    { return document.getElementById(id); }
function qs(sel)   { return document.querySelector(sel); }
function qsa(sel)  { return [...document.querySelectorAll(sel)]; }

function statusDot(s) {
  const map = { online: 'dot-green', offline: 'dot-red', warning: 'dot-yellow', error: 'dot-red', unknown: 'dot-gray' };
  return `<span class="dot ${map[s] || 'dot-gray'}"></span>`;
}

function statusBadge(s, text) {
  return `<span class="status-badge status-${s || 'unknown'}">${statusDot(s)}${text || s}</span>`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toast(msg, dur = 2500) {
  let t = el('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

function countBad(arr) {
  return arr.filter(i => i.status === 'offline' || i.status === 'error').length;
}
function countWarn(arr) {
  return arr.filter(i => i.status === 'warning').length;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigate(view) {
  state.view = view;
  qsa('.nav-item').forEach(li => li.classList.toggle('active', li.dataset.view === view));
  renderContent();
}

// ─── Sidebar badges ───────────────────────────────────────────────────────────

function updateBadges() {
  const hw = state.hardware;
  function setBadge(id, arr) {
    const b = el(id);
    if (!b) return;
    const bad  = countBad(arr);
    const warn = countWarn(arr);
    if (bad > 0)  { b.textContent = bad;  b.className = 'nav-badge'; }
    else if (warn > 0) { b.textContent = warn; b.className = 'nav-badge warn'; }
    else if (arr.length > 0) { b.textContent = '';  b.className = 'nav-badge ok'; }
    else { b.textContent = ''; b.className = 'nav-badge'; }
  }
  setBadge('badge-printer',  hw.printers);
  setBadge('badge-scanner',  hw.scanners);
  setBadge('badge-network',  hw.network);
  setBadge('badge-ecr',      hw.ecr);
  setBadge('badge-services', hw.services);

  // Overall dot
  const allItems = [...hw.printers, ...hw.network, ...hw.ecr, ...hw.services];
  const dot = el('status-dot');
  const txt = el('status-text');
  if (!state.lastScan) {
    dot.className = 'dot dot-gray';
    txt.textContent = 'Not scanned';
  } else {
    const bad  = allItems.filter(i => i.status === 'offline' || i.status === 'error').length;
    const warn = allItems.filter(i => i.status === 'warning').length;
    if (bad > 0) {
      dot.className = 'dot dot-red';
      txt.textContent = `${bad} issue${bad > 1 ? 's' : ''} found`;
    } else if (warn > 0) {
      dot.className = 'dot dot-yellow';
      txt.textContent = `${warn} warning${warn > 1 ? 's' : ''}`;
    } else {
      dot.className = 'dot dot-green';
      txt.textContent = 'All OK';
    }
  }
}

// ─── Scanning ─────────────────────────────────────────────────────────────────

async function runScan(section) {
  if (state.scanning) return;
  state.scanning = true;
  renderContent();   // show loading state

  try {
    if (!section || section === 'all') {
      const result = await window.api.hw.all();
      const ecrResult = await window.api.hw.ecr({
        ecrHost: state.settings.ecrHost,
        ecrPort: state.settings.ecrPort
      });
      state.hardware = { ...state.hardware, ...result, ecr: ecrResult };
      state.lastScan = new Date().toISOString();
    } else if (section === 'printers') {
      state.hardware.printers = await window.api.hw.printers();
    } else if (section === 'scanners') {
      state.hardware.scanners = await window.api.hw.scanners();
    } else if (section === 'network') {
      state.hardware.network = await window.api.hw.network();
    } else if (section === 'ecr') {
      state.hardware.ecr = await window.api.hw.ecr({
        ecrHost: state.settings.ecrHost,
        ecrPort: state.settings.ecrPort
      });
    } else if (section === 'services') {
      state.hardware.services = await window.api.hw.services();
    }
    if (!state.lastScan) state.lastScan = new Date().toISOString();
  } catch (e) {
    toast('Scan error: ' + e.message);
  }

  state.scanning = false;
  updateBadges();
  renderContent();
}

// ─── Auto-scan ────────────────────────────────────────────────────────────────

function setupAutoScan() {
  clearInterval(autoScanTimer);
  if (state.settings.autoScan) {
    const ms = (parseInt(state.settings.scanInterval, 10) || 60) * 1000;
    autoScanTimer = setInterval(() => runScan('all'), ms);
  }
}

// ─── Render router ────────────────────────────────────────────────────────────

function renderContent() {
  const c = el('content');
  if (!c) return;
  switch (state.view) {
    case 'dashboard': c.innerHTML = renderDashboard(); break;
    case 'printer':   c.innerHTML = renderPrinters();  break;
    case 'scanner':   c.innerHTML = renderScanners();  break;
    case 'network':   c.innerHTML = renderNetwork();   break;
    case 'ecr':       c.innerHTML = renderECR();       break;
    case 'services':  c.innerHTML = renderServices();  break;
    case 'chat':      renderChat(c);                   break;
    case 'settings':  c.innerHTML = renderSettings();  break;
    default:          c.innerHTML = renderDashboard();
  }
  bindContentEvents();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function renderDashboard() {
  const hw = state.hardware;
  const si = hw.sysinfo;
  const allItems = [...hw.printers, ...hw.network, ...hw.ecr, ...hw.services];
  const totalIssues = allItems.filter(i => i.status === 'offline' || i.status === 'error').length;
  const totalWarn   = allItems.filter(i => i.status === 'warning').length;
  const totalOK     = allItems.filter(i => i.status === 'online').length;

  const sections = [
    { key: 'printers', label: 'Printers',  arr: hw.printers,  icon: '🖨' },
    { key: 'network',  label: 'Network',   arr: hw.network,   icon: '🌐' },
    { key: 'ecr',      label: 'ECR/Bank',  arr: hw.ecr,       icon: '💳' },
    { key: 'services', label: 'Services',  arr: hw.services,  icon: '⚙'  },
    { key: 'scanners', label: 'Scanners',  arr: hw.scanners,  icon: '⬛' }
  ];

  const healthRows = sections.map(s => {
    const bad   = countBad(s.arr);
    const warn  = countWarn(s.arr);
    const ok    = s.arr.filter(i => i.status === 'online').length;
    const cls   = bad > 0 ? 'bad' : warn > 0 ? 'warn' : s.arr.length ? 'ok' : 'neutral';
    const badge = bad > 0 ? statusBadge('offline', `${bad} offline`)
                : warn > 0 ? statusBadge('warning', `${warn} warning`)
                : s.arr.length ? statusBadge('online', `${ok} OK`)
                : `<span class="timestamp">—</span>`;
    return `<div class="health-row">
      <span>${s.icon}</span>
      <span class="health-name">${s.label}</span>
      <span class="health-count">${s.arr.length || '—'}</span>
      ${badge}
    </div>`;
  }).join('');

  const sysinfoBlock = si.hostname ? `
    <div class="card mt-10">
      <div class="card-header mb-0">
        <span class="card-title">🖥 System Info</span>
        <span class="timestamp">${si.hostname}</span>
      </div>
      <div class="info-grid mt-10">
        <div class="info-item"><label>OS</label><span>${si.osName || si.release || '—'}</span></div>
        <div class="info-item"><label>IP Address</label><span>${si.localIp}</span></div>
        <div class="info-item"><label>CPU</label><span>${si.cores}× ${si.cpu?.split(' ').slice(-1)[0] || '—'}</span></div>
        <div class="info-item"><label>RAM</label><span>${si.ramFree} free / ${si.ramTotal}</span></div>
        <div class="info-item"><label>Uptime</label><span>${si.uptime}</span></div>
        <div class="info-item"><label>RAM Used</label><span>${si.ramUsedPct}</span></div>
      </div>
    </div>` : '';

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-sub">${state.lastScan ? 'Last scan: ' + formatTime(state.lastScan) : 'Run a scan to check hardware'}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-action="scan-all" ${state.scanning ? 'disabled' : ''}>
        ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Scan All
      </button>
    </div>

    <div class="dash-grid">
      <div class="stat-card ${totalIssues > 0 ? 'bad' : 'ok'}">
        <div class="stat-label">⚠ Issues</div>
        <div class="stat-value">${totalIssues}</div>
        <div class="stat-sub">Critical / offline</div>
      </div>
      <div class="stat-card ${totalWarn > 0 ? 'warn' : 'neutral'}">
        <div class="stat-label">! Warnings</div>
        <div class="stat-value">${totalWarn}</div>
        <div class="stat-sub">Need attention</div>
      </div>
      <div class="stat-card ok">
        <div class="stat-label">✓ Online</div>
        <div class="stat-value">${totalOK}</div>
        <div class="stat-sub">Healthy devices</div>
      </div>
      <div class="stat-card neutral">
        <div class="stat-label">◉ Total</div>
        <div class="stat-value">${allItems.length}</div>
        <div class="stat-sub">Monitored items</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title section-label">Hardware Health</div>
      ${healthRows || `<div class="empty-state">Run scan to see status</div>`}
    </div>

    ${sysinfoBlock}

    <button class="btn btn-secondary w-full mt-10" data-action="open-chat">
      🤖 Ask AI Assistant for help
    </button>
  `;
}

// ─── Printers view ────────────────────────────────────────────────────────────

function renderPrinters() {
  const printers = state.hardware.printers;
  const rows = printers.length ? printers.map(p => `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name">🖨 ${p.name}</div>
        <div class="device-sub">Port: ${p.port || '—'}${p.driver ? '  |  ' + p.driver : ''}</div>
      </div>
      ${statusBadge(p.status, p.statusText)}
    </div>`).join('') : `<div class="empty-state">No printers found. Run a scan.</div>`;

  return `
    <div class="page-header">
      <div><div class="page-title">🖨 Printers</div>
        <div class="page-sub">${printers.length} printer(s) detected</div></div>
      <button class="btn btn-primary btn-sm" data-action="scan-printers" ${state.scanning ? 'disabled' : ''}>
        ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Refresh
      </button>
    </div>
    <div class="card">${rows}</div>
    <div class="card">
      <div class="card-title">💡 Quick Fixes</div>
      <div style="margin-top:8px;font-size:12px;color:var(--gray-600);line-height:1.7">
        <b>Printer offline?</b><br>
        1. Check USB/network cable<br>
        2. Restart Print Spooler service<br>
        3. Clear print queue in Control Panel<br>
        4. Reinstall printer driver
      </div>
    </div>`;
}

// ─── Scanners view ────────────────────────────────────────────────────────────

function renderScanners() {
  const scanners = state.hardware.scanners;
  const rows = scanners.length ? scanners.map(s => `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name">⬛ ${s.name}</div>
        <div class="device-sub">${s.type || 'Scanner'}</div>
      </div>
      ${statusBadge(s.status, s.statusText)}
    </div>`).join('') : `<div class="empty-state">No scanners found. Run a scan.</div>`;

  return `
    <div class="page-header">
      <div><div class="page-title">⬛ Scanners</div>
        <div class="page-sub">${scanners.length} scanner(s) detected</div></div>
      <button class="btn btn-primary btn-sm" data-action="scan-scanners" ${state.scanning ? 'disabled' : ''}>
        ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Refresh
      </button>
    </div>
    <div class="card">${rows}</div>
    <div class="card">
      <div class="card-title">💡 Barcode Scanner Tips</div>
      <div style="margin-top:8px;font-size:12px;color:var(--gray-600);line-height:1.7">
        <b>Scanner not reading?</b><br>
        1. Check USB connection or COM port settings<br>
        2. Verify scanner is in HID/keyboard mode<br>
        3. Clean barcode reader glass with dry cloth<br>
        4. Check Device Manager for driver errors
      </div>
    </div>`;
}

// ─── Network view ─────────────────────────────────────────────────────────────

function renderNetwork() {
  const network = state.hardware.network;
  const rows = network.length ? network.map(n => `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name">🌐 ${n.name}</div>
        <div class="device-sub mono">${n.host}</div>
      </div>
      ${statusBadge(n.status, n.statusText)}
    </div>`).join('') : `<div class="empty-state">No network data. Run a scan.</div>`;

  return `
    <div class="page-header">
      <div><div class="page-title">🌐 Network</div>
        <div class="page-sub">Connectivity and DNS checks</div></div>
      <button class="btn btn-primary btn-sm" data-action="scan-network" ${state.scanning ? 'disabled' : ''}>
        ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Refresh
      </button>
    </div>
    <div class="card">${rows}</div>
    <div class="card">
      <div class="card-title">💡 Network Troubleshooting</div>
      <div style="margin-top:8px;font-size:12px;color:var(--gray-600);line-height:1.7">
        <b>Network down?</b><br>
        1. Check ethernet cable on back of PC<br>
        2. Check switch/hub LED lights<br>
        3. Run: <code style="font-family:monospace;background:#f1f5f9;padding:1px 4px">ipconfig /renew</code> in CMD<br>
        4. Restart network adapter in Device Manager
      </div>
    </div>`;
}

// ─── ECR / Bank Machine view ──────────────────────────────────────────────────

function renderECR() {
  const ecr = state.hardware.ecr;
  const rows = ecr.length ? ecr.map(e => `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name">💳 ${e.name}</div>
        <div class="device-sub mono">${e.host}</div>
      </div>
      ${statusBadge(e.status, e.statusText)}
    </div>`).join('') : `<div class="empty-state">No ECR scan data. Configure IP in Settings then scan.</div>`;

  return `
    <div class="page-header">
      <div><div class="page-title">💳 ECR / Bank Machine</div>
        <div class="page-sub">ECR: ${state.settings.ecrHost}:${state.settings.ecrPort}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" data-action="nav-settings">⚙ Config</button>
        <button class="btn btn-primary btn-sm" data-action="scan-ecr" ${state.scanning ? 'disabled' : ''}>
          ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Scan ECR
        </button>
      </div>
    </div>
    <div class="card">${rows}</div>
    <div class="card">
      <div class="card-title">💡 ECR Troubleshooting</div>
      <div style="margin-top:8px;font-size:12px;color:var(--gray-600);line-height:1.7">
        <b>Credit card machine not connecting?</b><br>
        1. Verify ECR IP address in Settings matches device<br>
        2. Check ECR cable (RJ-45 or USB) is secure<br>
        3. Ping ECR device from CMD: <code style="font-family:monospace;background:#f1f5f9;padding:1px 4px">ping ${state.settings.ecrHost}</code><br>
        4. Restart ECR service on POS software<br>
        5. Check if ECR port ${state.settings.ecrPort} is open (not blocked by firewall)
      </div>
    </div>`;
}

// ─── Services view ────────────────────────────────────────────────────────────

function renderServices() {
  const services = state.hardware.services;
  const rows = services.length ? services.map(s => `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name">⚙ ${s.name}</div>
        <div class="device-sub mono">${s.service}${s.startType ? ' · ' + s.startType : ''}</div>
      </div>
      ${statusBadge(s.status, s.statusText)}
    </div>`).join('') : `<div class="empty-state">No service data. Run a scan.</div>`;

  return `
    <div class="page-header">
      <div><div class="page-title">⚙ Windows Services</div>
        <div class="page-sub">Critical system services</div></div>
      <button class="btn btn-primary btn-sm" data-action="scan-services" ${state.scanning ? 'disabled' : ''}>
        ${state.scanning ? '<span class="spinner"></span>' : '⟳'} Refresh
      </button>
    </div>
    <div class="card">${rows}</div>
    <div class="card">
      <div class="card-title">💡 Service Issues</div>
      <div style="margin-top:8px;font-size:12px;color:var(--gray-600);line-height:1.7">
        <b>Service stopped?</b><br>
        1. Press <b>Win+R</b> → type <code style="font-family:monospace;background:#f1f5f9;padding:1px 4px">services.msc</code><br>
        2. Find the service → Right-click → Start<br>
        3. For Print Spooler: also run <code style="font-family:monospace;background:#f1f5f9;padding:1px 4px">net start Spooler</code>
      </div>
    </div>`;
}

// ─── AI Chat view ─────────────────────────────────────────────────────────────

function renderChat(container) {
  const quickPrompts = [
    'Printer not working',
    'Network disconnected',
    'Scanner not reading',
    'ECR timeout error',
    'POS software frozen',
    'Analyze last scan'
  ];

  const msgsHTML = state.chat.messages.map(m => {
    const time = m.time ? `<span class="msg-time">${m.time}</span>` : '';
    if (m.role === 'user') {
      return `<div class="msg msg-user">${escapeHtml(m.content)}${time}</div>`;
    }
    return `<div class="msg msg-ai">${renderMarkdownLite(m.content)}${time}</div>`;
  }).join('');

  const thinkingEl = state.chat.loading
    ? `<div class="msg-thinking"><span class="spinner"></span> AI is thinking…</div>`
    : '';

  const apiKeyWarning = !state.settings.apiKey
    ? `<div style="background:var(--warning-lt);border:1px solid #fcd34d;color:#92400e;padding:8px 10px;border-radius:var(--radius-sm);font-size:11.5px;margin-bottom:8px">
        ⚠ Gemini API key not set. <span style="cursor:pointer;text-decoration:underline" data-action="nav-settings">Open Settings →</span>
       </div>`
    : '';

  container.innerHTML = `
    <div class="page-header" style="margin-bottom:8px">
      <div><div class="page-title">🤖 AI Assistant</div>
           <div class="page-sub">Gemini-powered cashier support</div></div>
      <button class="btn btn-secondary btn-sm" data-action="clear-chat" title="Clear chat">🗑 Clear</button>
    </div>
    ${apiKeyWarning}
    <div id="chat-wrap">
      <div id="chat-messages">
        ${msgsHTML}
        ${thinkingEl}
      </div>
      <div class="chat-quick-btns">
        ${quickPrompts.map(p => `<button class="quick-btn" data-prompt="${p}">${p}</button>`).join('')}
      </div>
      <div id="chat-input-row">
        <textarea id="chat-input" rows="1" placeholder="Describe the issue…"
          ${state.chat.loading ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="btn-send"
          ${state.chat.loading || !state.settings.apiKey ? 'disabled' : ''}>Send</button>
      </div>
    </div>`;

  // Scroll to bottom
  setTimeout(() => {
    const msgs = el('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }, 50);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdownLite(text) {
  // Bold
  let out = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Code blocks
  out = out.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>');
  // Numbered list
  out = out.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  out = out.replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>');
  // Bullet list
  out = out.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  // Line breaks
  out = out.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  return out;
}

async function sendMessage(text) {
  if (!text.trim()) return;
  if (state.chat.loading) return;
  if (!state.settings.apiKey) { toast('Set Gemini API key in Settings first'); navigate('settings'); return; }

  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  state.chat.messages.push({ role: 'user', content: text.trim(), time });
  state.chat.loading = true;
  renderChat(el('content'));

  // Inject hardware context if asking about last scan
  let content = text.trim();
  if (/scan|hardware|status|check/i.test(content) && state.lastScan) {
    const hw = state.hardware;
    const summary = [
      `[SCAN @ ${formatTime(state.lastScan)}]`,
      `Printers: ${hw.printers.map(p => `${p.name}=${p.status}`).join(', ') || 'none'}`,
      `Network: ${hw.network.map(n => `${n.name}=${n.status}`).join(', ') || 'none'}`,
      `ECR: ${hw.ecr.map(e => `${e.name}=${e.status}`).join(', ') || 'none scanned'}`,
      `Services: ${hw.services.filter(s => s.status !== 'online').map(s => `${s.name}=${s.status}`).join(', ') || 'all OK'}`
    ].join('\n');
    content = content + '\n\nHARDWARE STATUS:\n' + summary;
  }

  const msgPayload = state.chat.messages.slice(0, -1)
    .concat([{ role: 'user', content }]);

  const result = await window.api.ai.chat({
    messages:     msgPayload,
    apiKey:       state.settings.apiKey,
    systemPrompt: buildSystemPrompt()
  });

  state.chat.loading = false;
  if (result.ok) {
    state.chat.messages.push({
      role:    'assistant',
      content: result.text,
      time:    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    });
  } else {
    state.chat.messages.push({
      role:    'assistant',
      content: `⚠ Error: ${result.error}`,
      time:    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    });
  }
  renderChat(el('content'));
}

// ─── Settings view ────────────────────────────────────────────────────────────

function renderSettings() {
  const s = state.settings;
  return `
    <div class="page-header">
      <div><div class="page-title">⚙ Settings</div>
           <div class="page-sub">Configure AI and hardware options</div></div>
    </div>

    <div id="save-banner" class="save-banner">✓ Settings saved successfully.</div>

    <div class="card">
      <div class="card-title section-label">AI Configuration</div>
      <div class="form-group mt-10">
        <label>Gemini API Key</label>
        <input id="set-apikey" type="password" class="form-input"
               placeholder="AIza…" value="${escapeHtml(s.apiKey || '')}" />
        <div class="form-hint">Get your key at aistudio.google.com → Get API key</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title section-label">Cashier Info</div>
      <div class="form-group mt-10">
        <label>Cashier / Workstation Name</label>
        <input id="set-cashier" type="text" class="form-input"
               placeholder="e.g. Cashier 3 – Main Floor" value="${escapeHtml(s.cashierName || '')}" />
      </div>
      <div class="form-group">
        <label>Store / Branch ID</label>
        <input id="set-storeid" type="text" class="form-input"
               placeholder="e.g. NAH-001" value="${escapeHtml(s.storeId || '')}" />
      </div>
    </div>

    <div class="card">
      <div class="card-title section-label">ECR / Bank Machine</div>
      <div class="form-group mt-10">
        <label>ECR IP Address</label>
        <input id="set-ecrhost" type="text" class="form-input"
               placeholder="192.168.1.100" value="${escapeHtml(s.ecrHost || '')}" />
        <div class="form-hint">IP address of credit card / ECR terminal</div>
      </div>
      <div class="form-group">
        <label>ECR Service Port</label>
        <input id="set-ecrport" type="number" class="form-input"
               placeholder="4000" value="${s.ecrPort || 4000}" />
      </div>
    </div>

    <div class="card">
      <div class="card-title section-label">Behaviour</div>
      <div class="form-group mt-10">
        <label class="form-check">
          <input type="checkbox" id="set-autoscan" ${s.autoScan ? 'checked' : ''} />
          Auto-scan hardware periodically
        </label>
      </div>
      <div class="form-group">
        <label>Scan interval (seconds)</label>
        <input id="set-interval" type="number" class="form-input"
               min="15" max="3600" value="${s.scanInterval || 60}" />
      </div>
      <div class="form-group">
        <label class="form-check">
          <input type="checkbox" id="set-pinned" ${s.pinned !== false ? 'checked' : ''} />
          Keep window always on top
        </label>
      </div>
    </div>

    <button class="btn btn-primary w-full" data-action="save-settings">Save Settings</button>
    <div style="height:10px"></div>
  `;
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindContentEvents() {
  const c = el('content');
  if (!c) return;

  // Action buttons (data-action)
  c.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'scan-all':       runScan('all');      break;
      case 'scan-printers':  runScan('printers'); break;
      case 'scan-scanners':  runScan('scanners'); break;
      case 'scan-network':   runScan('network');  break;
      case 'scan-ecr':       runScan('ecr');      break;
      case 'scan-services':  runScan('services'); break;
      case 'nav-settings':   navigate('settings'); break;
      case 'open-chat':      navigate('chat');    break;
      case 'clear-chat':
        state.chat.messages = [];
        renderChat(el('content'));
        break;
      case 'save-settings': {
        const s = state.settings;
        s.apiKey      = (el('set-apikey')   ?.value || '').trim();
        s.cashierName = (el('set-cashier')  ?.value || '').trim();
        s.storeId     = (el('set-storeid')  ?.value || '').trim();
        s.ecrHost     = (el('set-ecrhost')  ?.value || '192.168.1.100').trim();
        s.ecrPort     = parseInt(el('set-ecrport')?.value, 10) || 4000;
        s.autoScan    = el('set-autoscan')  ?.checked || false;
        s.scanInterval= parseInt(el('set-interval')?.value, 10) || 60;
        s.pinned      = el('set-pinned')    ?.checked !== false;

        await window.api.settings.save(s);
        await window.api.win.pin(s.pinned);

        setupAutoScan();

        const banner = el('save-banner');
        if (banner) { banner.style.display = 'block'; setTimeout(() => banner.style.display = 'none', 3000); }
        toast('Settings saved');
        break;
      }
    }
  });

  // Quick prompts in chat
  c.addEventListener('click', e => {
    const qb = e.target.closest('.quick-btn');
    if (qb) {
      const prompt = qb.dataset.prompt;
      if (prompt === 'Analyze last scan' && state.lastScan) {
        sendMessage('Analyze the latest hardware scan results and tell me what needs attention.');
      } else {
        const inp = el('chat-input');
        if (inp) { inp.value = prompt; inp.focus(); }
      }
    }
  });

  // Send button
  const btnSend = el('btn-send');
  if (btnSend) {
    btnSend.addEventListener('click', () => {
      const inp = el('chat-input');
      if (inp) { sendMessage(inp.value); inp.value = ''; }
    });
  }

  // Enter key in chat
  const chatInput = el('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const inp = el('chat-input');
        sendMessage(inp.value);
        inp.value = '';
      }
    });
    // Auto-resize
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
    });
  }
}

// ─── Title-bar controls ───────────────────────────────────────────────────────

function initTitleBar() {
  el('btn-minimize').addEventListener('click', () => window.api.win.minimize());
  el('btn-close').   addEventListener('click', () => window.api.win.close());
  el('btn-pin').addEventListener('click', async () => {
    state.pinned = !state.pinned;
    await window.api.win.pin(state.pinned);
    el('btn-pin').classList.toggle('active', state.pinned);
    toast(state.pinned ? 'Pinned on top' : 'Unpinned');
  });
}

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

function initSidebar() {
  el('nav-list').addEventListener('click', e => {
    const item = e.target.closest('.nav-item[data-view]');
    if (item) navigate(item.dataset.view);
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  initTitleBar();
  initSidebar();

  // Load settings from disk
  try {
    const saved = await window.api.settings.load();
    if (saved && typeof saved === 'object') {
      state.settings = { ...state.settings, ...saved };
    }
  } catch (_) {}

  // Sync pin button
  state.pinned = state.settings.pinned !== false;
  el('btn-pin').classList.toggle('active', state.pinned);

  // Welcome message in chat
  state.chat.messages = [{
    role: 'assistant',
    content: `👋 Hi! I'm your Naheed cashier support assistant.\n\nI can help diagnose **printer**, **scanner**, **network**, **ECR/bank machine**, and **POS software** issues.\n\nRun a hardware scan first, then ask me about any problems.`,
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }];

  renderContent();
  setupAutoScan();

  // Auto-run initial scan
  setTimeout(() => runScan('all'), 400);
}

document.addEventListener('DOMContentLoaded', init);
