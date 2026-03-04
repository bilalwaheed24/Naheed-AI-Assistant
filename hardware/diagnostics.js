/**
 * Naheed Supermarket – Cashier Hardware Diagnostics
 * Cross-platform: Windows (PowerShell/WMI) + Linux (CUPS/systemd/lsusb)
 */

const { exec }       = require('child_process');
const net             = require('net');
const dns             = require('dns');
const os              = require('os');
const fs              = require('fs');
const { promisify }  = require('util');

const execAsync = promisify(exec);

const IS_WIN = process.platform === 'win32';
const IS_LIN = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run PowerShell (Windows only) */
async function ps(command, timeout = 12000) {
  const escaped = command.replace(/"/g, '\\"');
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${escaped}"`,
    { timeout, windowsHide: true }
  );
  return stdout.trim();
}

/** Run shell command (Linux/Mac) */
async function sh(command, timeout = 10000) {
  const { stdout } = await execAsync(command, { timeout });
  return stdout.trim();
}

/** Safe JSON parse */
function safeJSON(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

/** TCP port reachability */
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

/** Cross-platform ping */
async function ping(host, timeoutMs = 2000) {
  try {
    let cmd;
    if (IS_WIN) {
      cmd = `ping -n 1 -w ${timeoutMs} ${host}`;
    } else {
      const sec = Math.max(1, Math.floor(timeoutMs / 1000));
      cmd = `ping -c 1 -W ${sec} ${host}`;
    }
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs + 3000 });
    return IS_WIN
      ? /TTL=/i.test(stdout)
      : /\d bytes from/.test(stdout) || /1 received/.test(stdout);
  } catch (_) { return false; }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600)  / 60);
  return `${d}d ${h}h ${m}m`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PRINTERS
// ═════════════════════════════════════════════════════════════════════════════

async function checkPrinters() {
  if (IS_WIN) return _checkPrintersWin();
  return _checkPrintersLinux();
}

async function _checkPrintersWin() {
  try {
    const raw = await ps(
      'Get-Printer | Select-Object Name,PrinterStatus,PortName,DriverName | ConvertTo-Json -Compress'
    );
    if (!raw || raw === 'null') return [{ name: 'No printers found', status: 'warning', statusText: 'None installed', port: '' }];
    const list = Array.isArray(safeJSON(raw)) ? safeJSON(raw) : [safeJSON(raw)];
    return list.filter(Boolean).map(p => ({
      name:       p.Name       || 'Unknown Printer',
      port:       p.PortName   || 'N/A',
      driver:     p.DriverName || '',
      status:     p.PrinterStatus === 0 ? 'online' : p.PrinterStatus === 1 ? 'warning' : 'offline',
      statusText: p.PrinterStatus === 0 ? 'Ready'  : p.PrinterStatus === 1 ? 'Paused'  : 'Error / Offline'
    }));
  } catch (_) {
    // wmic fallback
    try {
      const { stdout } = await execAsync('wmic printer get Name,PrinterStatus,PortName /format:csv', { timeout: 8000, windowsHide: true });
      const lines = stdout.trim().split(/\r?\n/).filter(l => l.trim() && !l.startsWith('Node'));
      if (!lines.length) return [{ name: 'No printers detected', status: 'warning', statusText: 'wmic fallback', port: '' }];
      return lines.map(line => {
        const [, name, port, pStatus] = line.split(',');
        return {
          name:       (name    || '').trim() || 'Unknown',
          port:       (port    || '').trim() || 'N/A',
          driver:     '',
          status:     (pStatus || '').trim().toLowerCase() === 'ok' ? 'online' : 'warning',
          statusText: (pStatus || '').trim() || 'Unknown'
        };
      });
    } catch (e2) {
      return [{ name: 'Printer check failed', status: 'error', statusText: e2.message, port: '' }];
    }
  }
}

async function _checkPrintersLinux() {
  const results = [];
  try {
    // CUPS: lpstat -p gives per-printer status
    const raw = await sh('lpstat -p 2>/dev/null || echo "NO_CUPS"');

    if (raw === 'NO_CUPS' || !raw) {
      results.push({ name: 'CUPS not running', status: 'warning', statusText: 'Install/start cups', port: 'N/A', driver: '' });
      return results;
    }

    const lines = raw.split('\n').filter(l => l.startsWith('printer '));
    if (!lines.length) {
      results.push({ name: 'No printers found', status: 'warning', statusText: 'Add via CUPS', port: 'N/A', driver: '' });
      return results;
    }

    for (const line of lines) {
      // e.g. "printer HP_LaserJet is idle."  or "printer Canon is disabled since..."
      const match = line.match(/^printer (\S+) is (.+?)\.?$/i);
      const name  = match?.[1] || 'Unknown';
      const state = (match?.[2] || '').toLowerCase();
      const ok    = state.includes('idle') || state.includes('processing');
      const warn  = state.includes('disabled') || state.includes('paused');
      results.push({
        name,
        port:       'CUPS',
        driver:     '',
        status:     ok ? 'online' : warn ? 'warning' : 'offline',
        statusText: match?.[2] || state
      });
    }
  } catch (e) {
    results.push({ name: 'Printer check failed', status: 'error', statusText: e.message, port: '' });
  }
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SCANNERS
// ═════════════════════════════════════════════════════════════════════════════

async function checkScanners() {
  if (IS_WIN) return _checkScannersWin();
  return _checkScannersLinux();
}

async function _checkScannersWin() {
  const results = [];
  try {
    const wiaRaw = await ps(
      `Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Image' } | Select-Object Name,Status | ConvertTo-Json -Compress`
    );
    const wiaList = safeJSON(wiaRaw);
    if (wiaList) {
      const arr = Array.isArray(wiaList) ? wiaList : [wiaList];
      arr.filter(Boolean).forEach(d => results.push({
        name: d.Name || 'Unknown Scanner', type: 'WIA / Image',
        status: d.Status === 'OK' ? 'online' : 'warning', statusText: d.Status || 'Unknown'
      }));
    }
    const hidRaw = await ps(
      `(Get-WmiObject Win32_PnPEntity | Where-Object { $_.Description -like '*Barcode*' -or $_.Description -like '*Scanner*' } | Select-Object Name,Status | ConvertTo-Json -Compress)`
    );
    const hidList = safeJSON(hidRaw);
    if (hidList) {
      const arr = Array.isArray(hidList) ? hidList : [hidList];
      arr.filter(Boolean).forEach(d => results.push({
        name: d.Name || 'HID Scanner', type: 'Barcode / HID',
        status: d.Status === 'OK' ? 'online' : 'warning', statusText: d.Status || 'Unknown'
      }));
    }
    if (!results.length) results.push({ name: 'No scanners detected', type: 'N/A', status: 'warning', statusText: 'Check USB / COM port' });
  } catch (e) {
    results.push({ name: 'Scanner check failed', type: '', status: 'error', statusText: e.message });
  }
  return results;
}

async function _checkScannersLinux() {
  const results = [];
  try {
    // lsusb – look for known scanner/barcode vendors
    const usbRaw = await sh('lsusb 2>/dev/null || echo ""');
    const scannerKeywords = /scan|barcode|honeywell|zebra|datalogic|metrologic|opticon|symbol|hand held|handheld/i;
    const imageKeywords   = /canon|epson|brother|hp|hewlett|lexmark|samsung|seiko/i;

    const usbLines = usbRaw.split('\n').filter(l => scannerKeywords.test(l) || imageKeywords.test(l));
    usbLines.forEach(l => {
      const m = l.match(/ID \w+:\w+ (.+)/);
      results.push({
        name:       m ? m[1].trim() : l.trim(),
        type:       scannerKeywords.test(l) ? 'Barcode / USB' : 'USB Image Device',
        status:     'online',
        statusText: 'USB connected'
      });
    });

    // SANE scanners
    try {
      const saneRaw = await sh('sane-find-scanner -q 2>/dev/null | head -20');
      if (saneRaw && !saneRaw.includes('No scanners')) {
        saneRaw.split('\n').filter(Boolean).forEach(l => {
          results.push({ name: l.trim(), type: 'SANE', status: 'online', statusText: 'Detected by SANE' });
        });
      }
    } catch (_) {}

    // /dev/usb/lp* for USB barcode scanners
    try {
      const devRaw = await sh('ls /dev/usb/lp* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo ""');
      devRaw.split('\n').filter(Boolean).forEach(dev => {
        if (!results.find(r => r.name.includes(dev))) {
          results.push({ name: dev, type: 'USB Serial / Printer port', status: 'online', statusText: 'Device node present' });
        }
      });
    } catch (_) {}

    if (!results.length) {
      results.push({ name: 'No scanners detected', type: 'N/A', status: 'warning', statusText: 'Check USB – run: lsusb' });
    }
  } catch (e) {
    results.push({ name: 'Scanner check failed', type: '', status: 'error', statusText: e.message });
  }
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NETWORK
// ═════════════════════════════════════════════════════════════════════════════

async function checkNetwork() {
  const ifaces  = os.networkInterfaces();
  const localIp = Object.values(ifaces).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'Unknown';

  // Get default gateway – platform aware
  let gateway = '192.168.1.1';
  try {
    if (IS_WIN) {
      const gw = await ps('(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).NextHop');
      gateway = gw.trim() || gateway;
    } else {
      const gw = await sh("ip route | grep '^default' | awk '{print $3}' | head -1");
      gateway = gw.trim() || gateway;
    }
  } catch (_) {}

  const targets = [
    { name: 'Local Adapter',   host: localIp,      check: 'info' },
    { name: 'Default Gateway', host: gateway,       check: 'ping' },
    { name: 'Internet (8.8.8.8)', host: '8.8.8.8', check: 'ping' },
    { name: 'DNS Resolution',  host: 'google.com',  check: 'dns'  }
  ];

  return Promise.all(targets.map(async t => {
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
}

// ═════════════════════════════════════════════════════════════════════════════
//  ECR / BANK MACHINE  (pure TCP – same on all platforms)
// ═════════════════════════════════════════════════════════════════════════════

async function checkECR(config = {}) {
  const host = config.ecrHost || '192.168.1.100';
  const port = parseInt(config.ecrPort, 10) || 4000;

  const [pingOk, portOk] = await Promise.all([ping(host), tcpCheck(host, port, 3000)]);

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

// ═════════════════════════════════════════════════════════════════════════════
//  SERVICES
// ═════════════════════════════════════════════════════════════════════════════

async function checkServices() {
  if (IS_WIN) return _checkServicesWin();
  return _checkServicesLinux();
}

async function _checkServicesWin() {
  const wanted = [
    { label: 'Print Spooler',    name: 'Spooler'          },
    { label: 'Event Log',        name: 'EventLog'         },
    { label: 'DHCP Client',      name: 'Dhcp'             },
    { label: 'DNS Client',       name: 'Dnscache'         },
    { label: 'Network List Svc', name: 'netprofm'         },
    { label: 'Workstation (SMB)',name: 'LanmanWorkstation' },
    { label: 'Remote Registry',  name: 'RemoteRegistry'   }
  ];
  const nameList = wanted.map(s => `'${s.name}'`).join(',');
  try {
    const raw  = await ps(`Get-Service -Name @(${nameList}) -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | ConvertTo-Json -Compress`);
    const list = safeJSON(raw);
    if (!list) throw new Error('empty');
    const arr  = Array.isArray(list) ? list : [list];
    const map  = {};
    arr.filter(Boolean).forEach(s => { map[s.Name] = s; });
    return wanted.map(w => {
      const s = map[w.name];
      return {
        name:       w.label,
        service:    w.name,
        status:     !s ? 'warning' : s.Status === 4 ? 'online' : s.Status === 1 ? 'offline' : 'warning',
        statusText: !s ? 'Not found' : s.Status === 4 ? 'Running' : s.Status === 1 ? 'Stopped' : 'Other',
        startType:  s ? (s.StartType === 2 ? 'Auto' : s.StartType === 3 ? 'Manual' : 'Disabled') : ''
      };
    });
  } catch (e) {
    return wanted.map(w => ({ name: w.label, service: w.name, status: 'error', statusText: 'Check failed', startType: '' }));
  }
}

async function _checkServicesLinux() {
  const wanted = [
    { label: 'CUPS (Printing)',       name: 'cups'              },
    { label: 'Network Manager',       name: 'NetworkManager'    },
    { label: 'systemd-resolved (DNS)',name: 'systemd-resolved'  },
    { label: 'DHCP Client',           name: 'dhcpcd'            },
    { label: 'SSH Server',            name: 'sshd'              },
    { label: 'Avahi (mDNS)',          name: 'avahi-daemon'      },
    { label: 'Firewall (ufw)',        name: 'ufw'               }
  ];

  return Promise.all(wanted.map(async w => {
    try {
      const out = await sh(`systemctl is-active ${w.name} 2>/dev/null || echo "unknown"`);
      const state = out.trim().toLowerCase();
      return {
        name:       w.label,
        service:    w.name,
        status:     state === 'active'   ? 'online'
                  : state === 'inactive' ? 'offline'
                  : state === 'failed'   ? 'error'
                  : 'warning',
        statusText: state.charAt(0).toUpperCase() + state.slice(1),
        startType:  ''
      };
    } catch (_) {
      return { name: w.label, service: w.name, status: 'warning', statusText: 'Not found', startType: '' };
    }
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
//  SYSTEM INFO
// ═════════════════════════════════════════════════════════════════════════════

async function getSystemInfo() {
  const cpus  = os.cpus();
  const total = os.totalmem();
  const free  = os.freemem();
  const info  = {
    hostname:   os.hostname(),
    platform:   IS_WIN ? 'Windows' : IS_LIN ? 'Linux' : 'macOS',
    arch:       os.arch(),
    release:    os.release(),
    cpu:        cpus[0]?.model || 'Unknown',
    cores:      cpus.length,
    ramTotal:   `${(total / 1073741824).toFixed(1)} GB`,
    ramFree:    `${(free  / 1073741824).toFixed(1)} GB`,
    ramUsedPct: `${Math.round((1 - free / total) * 100)}%`,
    uptime:     formatUptime(os.uptime()),
    localIp:    Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'N/A',
    osName:     `${os.type()} ${os.release()}`
  };

  try {
    if (IS_WIN) {
      const v = await ps('(Get-WmiObject Win32_OperatingSystem).Caption');
      info.osName = v.trim();
    } else if (IS_LIN) {
      // Try /etc/os-release first
      const rel = await sh('cat /etc/os-release 2>/dev/null || lsb_release -d 2>/dev/null || uname -a');
      const match = rel.match(/PRETTY_NAME="?([^"\n]+)"?/);
      if (match) info.osName = match[1];
      else {
        const lsb = rel.match(/Description:\s+(.+)/);
        if (lsb) info.osName = lsb[1].trim();
      }
    }
  } catch (_) {}

  return info;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHECK ALL
// ═════════════════════════════════════════════════════════════════════════════

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
