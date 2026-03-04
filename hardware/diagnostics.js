/**
 * Naheed Supermarket – Cashier Hardware Diagnostics
 * Runs on Windows via PowerShell / WMI / native Node
 */

const { exec }  = require('child_process');
const net        = require('net');
const dns        = require('dns');
const os         = require('os');
const { promisify } = require('util');

const execAsync  = promisify(exec);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run a PowerShell command and return stdout */
async function ps(command, timeout = 12000) {
  const escaped = command.replace(/"/g, '\\"');
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${escaped}"`,
    { timeout, windowsHide: true }
  );
  return stdout.trim();
}

/** Safe JSON parse – returns null on failure */
function safeJSON(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

/** TCP port reachability check */
function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => finish(true));
    sock.on('error',   () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

/** ICMP-style ping via OS ping command */
async function ping(host, timeoutMs = 2000) {
  try {
    const t = Math.floor(timeoutMs / 1000) || 1;
    // Windows ping: -n 1 packet, -w timeout in ms
    const { stdout } = await execAsync(`ping -n 1 -w ${timeoutMs} ${host}`, {
      timeout: timeoutMs + 2000, windowsHide: true
    });
    return /TTL=/i.test(stdout) || /bytes=/i.test(stdout);
  } catch (_) { return false; }
}

/** Status helper */
function status(ok, warn) {
  if (ok)   return 'online';
  if (warn) return 'warning';
  return 'offline';
}

// ─── Printers ────────────────────────────────────────────────────────────────

async function checkPrinters() {
  try {
    const raw = await ps(
      'Get-Printer | Select-Object Name,PrinterStatus,PortName,DriverName,Shared | ConvertTo-Json -Compress'
    );
    if (!raw || raw === 'null') return [{ name: 'No printers found', status: 'warning', statusText: 'None installed', port: '' }];

    const list = Array.isArray(safeJSON(raw)) ? safeJSON(raw) : [safeJSON(raw)];
    return list.filter(Boolean).map(p => ({
      name:       p.Name        || 'Unknown Printer',
      port:       p.PortName    || 'N/A',
      driver:     p.DriverName  || '',
      shared:     p.Shared      ? 'Yes' : 'No',
      status:     p.PrinterStatus === 0 ? 'online' : p.PrinterStatus === 1 ? 'warning' : 'offline',
      statusText: p.PrinterStatus === 0 ? 'Ready' : p.PrinterStatus === 1 ? 'Paused' : 'Error / Offline'
    }));
  } catch (_) {
    // Fallback: wmic
    try {
      const { stdout } = await execAsync('wmic printer get Name,PrinterStatus,PortName /format:csv', {
        timeout: 8000, windowsHide: true
      });
      const lines = stdout.trim().split(/\r?\n/).filter(l => l.trim() && !l.startsWith('Node'));
      if (!lines.length) return [{ name: 'No printers detected', status: 'warning', statusText: 'wmic fallback', port: '' }];
      return lines.map(line => {
        const [, name, port, pStatus] = line.split(',');
        return {
          name:       (name   || '').trim() || 'Unknown',
          port:       (port   || '').trim() || 'N/A',
          driver:     '',
          shared:     '',
          status:     (pStatus || '').trim().toLowerCase() === 'ok' ? 'online' : 'warning',
          statusText: (pStatus || '').trim() || 'Unknown'
        };
      });
    } catch (e2) {
      return [{ name: 'Printer check failed', status: 'error', statusText: e2.message, port: '' }];
    }
  }
}

// ─── Scanners ────────────────────────────────────────────────────────────────

async function checkScanners() {
  const results = [];
  try {
    // WIA devices (flatbed / document scanners)
    const wiaRaw = await ps(
      `Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Image' } | Select-Object Name,Status | ConvertTo-Json -Compress`
    );
    const wiaList = safeJSON(wiaRaw);
    if (wiaList) {
      const arr = Array.isArray(wiaList) ? wiaList : [wiaList];
      arr.filter(Boolean).forEach(d => results.push({
        name:       d.Name   || 'Unknown Scanner',
        type:       'WIA / Image',
        status:     d.Status === 'OK' ? 'online' : 'warning',
        statusText: d.Status || 'Unknown'
      }));
    }

    // HID barcode scanners (appear as keyboard / HID)
    const hidRaw = await ps(
      `(Get-WmiObject Win32_PnPEntity | Where-Object { $_.Description -like '*Barcode*' -or $_.Description -like '*Scanner*' -or $_.Description -like '*Scan*' } | Select-Object Name,Status | ConvertTo-Json -Compress)`
    );
    const hidList = safeJSON(hidRaw);
    if (hidList) {
      const arr = Array.isArray(hidList) ? hidList : [hidList];
      arr.filter(Boolean).forEach(d => results.push({
        name:       d.Name   || 'HID Scanner',
        type:       'Barcode / HID',
        status:     d.Status === 'OK' ? 'online' : 'warning',
        statusText: d.Status || 'Unknown'
      }));
    }

    if (!results.length) {
      results.push({ name: 'No scanners detected', type: 'N/A', status: 'warning', statusText: 'Check USB / COM port' });
    }
  } catch (e) {
    results.push({ name: 'Scanner check failed', type: '', status: 'error', statusText: e.message });
  }
  return results;
}

// ─── Network ─────────────────────────────────────────────────────────────────

async function checkNetwork() {
  const ifaces  = os.networkInterfaces();
  const localIp = Object.values(ifaces).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'Unknown';

  // Detect default gateway
  let gateway = '192.168.1.1';
  try {
    const gwRaw = await execAsync(
      'powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).NextHop"',
      { timeout: 5000, windowsHide: true }
    );
    gateway = gwRaw.stdout.trim() || gateway;
  } catch (_) {}

  const targets = [
    { name: 'Local Adapter',   host: localIp,         check: 'info' },
    { name: 'Default Gateway', host: gateway,          check: 'ping' },
    { name: 'Internet (DNS)',   host: '8.8.8.8',       check: 'ping' },
    { name: 'DNS Resolution',   host: 'google.com',    check: 'dns'  }
  ];

  const results = await Promise.all(targets.map(async t => {
    if (t.check === 'info') {
      return { name: t.name, host: t.host, status: t.host !== 'Unknown' ? 'online' : 'warning', statusText: t.host };
    }
    if (t.check === 'dns') {
      const ok = await new Promise(r => dns.lookup(t.host, e => r(!e)));
      return { name: t.name, host: t.host, status: ok ? 'online' : 'offline', statusText: ok ? 'Resolving' : 'DNS Fail' };
    }
    const ok = await ping(t.host);
    return { name: t.name, host: t.host, status: ok ? 'online' : 'offline', statusText: ok ? 'Reachable' : 'Unreachable' };
  }));

  return results;
}

// ─── ECR / Bank Machine ───────────────────────────────────────────────────────

async function checkECR(config = {}) {
  const host = config.ecrHost || '192.168.1.100';
  const port = parseInt(config.ecrPort, 10) || 4000;

  const [pingOk, portOk] = await Promise.all([
    ping(host),
    tcpCheck(host, port, 3000)
  ]);

  return [
    {
      name:       'ECR Device Ping',
      host,
      status:     pingOk ? 'online' : 'offline',
      statusText: pingOk ? 'Network reachable' : 'Not reachable'
    },
    {
      name:       `ECR Service (port ${port})`,
      host:       `${host}:${port}`,
      status:     portOk ? 'online' : 'offline',
      statusText: portOk ? 'Port open – service running' : 'Port closed / no response'
    }
  ];
}

// ─── Windows Services ────────────────────────────────────────────────────────

async function checkServices() {
  const wanted = [
    { label: 'Print Spooler',          name: 'Spooler'     },
    { label: 'Event Log',              name: 'EventLog'    },
    { label: 'DHCP Client',            name: 'Dhcp'        },
    { label: 'DNS Client',             name: 'Dnscache'    },
    { label: 'Network List Svc',       name: 'netprofm'    },
    { label: 'Workstation (SMB)',       name: 'LanmanWorkstation' },
    { label: 'Remote Registry',        name: 'RemoteRegistry' }
  ];

  const nameList = wanted.map(s => `'${s.name}'`).join(',');
  let results = [];

  try {
    const raw = await ps(
      `Get-Service -Name @(${nameList}) -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | ConvertTo-Json -Compress`
    );
    const list = safeJSON(raw);
    if (list) {
      const arr  = Array.isArray(list) ? list : [list];
      const map  = {};
      arr.filter(Boolean).forEach(s => { map[s.Name] = s; });

      results = wanted.map(w => {
        const s = map[w.name];
        return {
          name:       w.label,
          service:    w.name,
          status:     !s ? 'warning' : s.Status === 4 ? 'online' : s.Status === 1 ? 'offline' : 'warning',
          statusText: !s ? 'Not found' : s.Status === 4 ? 'Running' : s.Status === 1 ? 'Stopped' : 'Paused / Other',
          startType:  s ? (s.StartType === 2 ? 'Auto' : s.StartType === 3 ? 'Manual' : 'Disabled') : ''
        };
      });
    }
  } catch (e) {
    results = wanted.map(w => ({ name: w.label, service: w.name, status: 'error', statusText: 'Check failed', startType: '' }));
  }

  return results;
}

// ─── System Info ─────────────────────────────────────────────────────────────

async function getSystemInfo() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free  = os.freemem();
  const info  = {
    hostname:  os.hostname(),
    platform:  os.platform(),
    arch:      os.arch(),
    release:   os.release(),
    cpu:       cpus[0]?.model || 'Unknown',
    cores:     cpus.length,
    ramTotal:  `${(total / 1073741824).toFixed(1)} GB`,
    ramFree:   `${(free  / 1073741824).toFixed(1)} GB`,
    ramUsedPct:`${Math.round((1 - free / total) * 100)}%`,
    uptime:    formatUptime(os.uptime()),
    localIp:   Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'N/A'
  };

  try {
    const winVer = await ps('(Get-WmiObject Win32_OperatingSystem).Caption');
    info.osName  = winVer.trim();
  } catch (_) { info.osName = `${os.type()} ${os.release()}`; }

  return info;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600)  / 60);
  return `${d}d ${h}h ${m}m`;
}

// ─── Check All ───────────────────────────────────────────────────────────────

async function checkAll(ecrConfig) {
  const [printers, scanners, network, services, sysinfo] = await Promise.allSettled([
    checkPrinters(),
    checkScanners(),
    checkNetwork(),
    checkServices(),
    getSystemInfo()
  ]);

  return {
    printers:  printers.status  === 'fulfilled' ? printers.value  : [],
    scanners:  scanners.status  === 'fulfilled' ? scanners.value  : [],
    network:   network.status   === 'fulfilled' ? network.value   : [],
    services:  services.status  === 'fulfilled' ? services.value  : [],
    sysinfo:   sysinfo.status   === 'fulfilled' ? sysinfo.value   : {},
    ecr:       [],
    timestamp: new Date().toISOString()
  };
}

module.exports = { checkAll, checkPrinters, checkScanners, checkNetwork, checkECR, checkServices, getSystemInfo };
