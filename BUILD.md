# Naheed AI Assistant – Build Guide

## Prerequisites
- Node.js 18+ installed on build machine
- Windows (or Wine on Linux) for .exe packaging

## Install & Run (Development)
```bash
cd naheed-assistant
npm install
npm start
```

## Build Windows EXE

### Portable EXE (recommended for cashiers – no install needed)
```bash
npm run build:portable
# Output: dist/NaheedAIAssistant-Portable.exe
```

### Installer EXE (installs to Program Files)
```bash
npm run build:installer
# Output: dist/NaheedAIAssistant-Setup.exe
```

### Both targets
```bash
npm run build
```

## First-Time Setup on Cashier PC
1. Copy `NaheedAIAssistant-Portable.exe` to the cashier desktop
2. Double-click to run (no installation needed)
3. Go to **Settings** → enter Gemini API key
4. Set ECR IP address (check with IT if unknown)
5. Click **Scan All** to verify all hardware

## Getting a Gemini API Key
1. Visit https://aistudio.google.com
2. Sign in with Google account
3. Click **Get API key** → Create API key
4. Copy and paste into Settings

## App Icon (optional)
Place a 256×256 `icon.ico` file in the `assets/` folder before building.
Online converter: https://convertio.co/png-ico/
