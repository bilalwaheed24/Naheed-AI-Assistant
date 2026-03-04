# Naheed AI Assistant 🤖

> Professional AI-powered cashier system diagnostic tool for **Naheed Supermarket**

A lightweight, always-on-top desktop app (Windows EXE) that helps IT staff and cashiers quickly diagnose and fix POS hardware issues using real-time hardware scanning + Gemini AI support.

---

## Features

| Module | What it checks |
|---|---|
| 🖨 **Printers** | Connected receipt printers, status, port, driver |
| ⬛ **Scanners** | Barcode scanners (USB/HID) and WIA image devices |
| 🌐 **Network** | Gateway ping, internet connectivity, DNS resolution |
| 💳 **ECR / Bank Machine** | Credit card terminal reachability + service port |
| ⚙ **Services** | Windows services: Spooler, DHCP, DNS, EventLog, etc. |
| 🤖 **AI Chat** | Gemini 1.5 Flash — diagnoses issues with hardware context |

---

## Screenshots

```
┌─ Naheed AI Assistant ──────── 📌 _ ✕ ┐
│                                        │
│  ⊞ Dashboard  │  ⊞ Dashboard           │
│  🖨 Printers  │  ┌──────┐ ┌──────┐    │
│  ⬛ Scanners  │  │Issues│ │ OK   │    │
│  🌐 Network   │  │  0   │ │  12  │    │
│  💳 ECR/Bank  │  └──────┘ └──────┘    │
│  ⚙ Services  │                        │
│  ─────────    │  [⟳ Scan All]         │
│  🤖 AI Chat   │                        │
│  ⚙ Settings  │  [🤖 Ask AI Assistant] │
└────────────────────────────────────────┘
```

---

## Installation

### Option A — Portable (recommended for cashiers)
1. Download `NaheedAIAssistant-Portable.exe` from Releases
2. Double-click — no installation needed
3. Go to **Settings** → enter your Gemini API key
4. Click **Scan All**

### Option B — Installer
Run `NaheedAIAssistant-Setup.exe` — installs to Program Files + desktop shortcut

---

## Build from Source

```bash
# Prerequisites: Node.js 18+
git clone https://github.com/bilalwaheed24/Naheed-AI-Assistant.git
cd Naheed-AI-Assistant
npm install

# Run in development
npm start

# Build Windows EXE
npm run build:portable    # → dist/NaheedAIAssistant-Portable.exe
npm run build:installer   # → dist/NaheedAIAssistant-Setup.exe
```

---

## Get a Gemini API Key (Free)
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with Google
3. Click **Get API key** → Create API key
4. Paste into app Settings

---

## Tech Stack

- **Electron 33** — Desktop shell (bundles Node.js, no dependencies on cashier PC)
- **Vanilla JS** — Lightweight renderer, no framework needed
- **Gemini 1.5 Flash** — AI diagnosis via `@google/generative-ai`
- **PowerShell / WMI** — Windows hardware detection
- **electron-builder** — Packages to `.exe`

---

## Hardware Diagnostics Detail

- **Printers:** `Get-Printer` PowerShell with WMIC fallback
- **Scanners:** WMI `Win32_PnPEntity` (Image class + HID barcode devices)
- **Network:** ICMP ping (auto-detects default gateway) + DNS lookup
- **ECR:** TCP port check to configurable IP:port (default `192.168.1.100:4000`)
- **Services:** `Get-Service` for 7 critical Windows services

---

*Built for Naheed Supermarket IT support*
