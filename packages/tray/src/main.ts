import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { band, buildViewModel, createDefaultCollector, worstPct } from '@agent-usage/core';
import { ICON_SIZE, renderIconBitmap } from './icon';
import { createSafeRender } from './render';
import { refreshForced, refreshOnOpen } from './refresh';
import { trayTooltip } from './tooltip';
import { buildPromoteScript } from './promote';

const isDebug = Boolean(process.env.DEBUG_AGENT_USAGE);
const debugLogPath = path.join(process.env.APPDATA ?? '', 'agent-usage', 'debug.log');
function logDebug(msg: string, force = false) {
  if (!isDebug && !force) return;
  try {
    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] [PID ${process.pid}] ${msg}\n`);
  } catch {
    // ignore
  }
}

process.on('uncaughtException', (err) => {
  logDebug(`uncaughtException: ${err?.stack || err}`, true);
});

process.on('unhandledRejection', (reason) => {
  logDebug(`unhandledRejection: ${reason}`, true);
});

app.setAppUserModelId('com.vnmartinez.agentusage');
logDebug(`App starting. execPath=${process.execPath}, isPackaged=${app.isPackaged}`);

function promoteTrayIcon(): void {
  if (process.platform !== 'win32') return;
  const exePath = process.execPath;
  const script = buildPromoteScript(exePath);
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (err) => {
    if (err) logDebug(`promoteTrayIcon error: ${err.message}`, true);
    else logDebug('promoteTrayIcon executed');
  });
}

const POPUP_WIDTH = 340;
const POPUP_HEIGHT = 460;

function iconFor(pct: number | null) {
  const bitmap = renderIconBitmap(pct, pct === null ? null : band(pct));
  return nativeImage.createFromBitmap(bitmap, { width: ICON_SIZE, height: ICON_SIZE, scaleFactor: 2 });
}

let tray: Tray | null = null;
let popup: BrowserWindow | null = null;
let collector: ReturnType<typeof createDefaultCollector> | null = null;
let renderTimer: ReturnType<typeof setInterval> | undefined;
let hiddenAt = 0;
let shownAt = 0;

if (!app.requestSingleInstanceLock()) {
  logDebug('Single instance lock failed, quitting.');
  app.quit();
} else {
  logDebug('Single instance lock acquired.');
  // App de bandeja: continua rodando sem janelas visíveis.
  app.on('window-all-closed', () => {});

  const togglePopup = () => {
    if (!popup || !tray) return;
    if (popup.isVisible()) {
      popup.hide();
      return;
    }
    if (Date.now() - hiddenAt < 250) return; // este clique acabou de fechar o popup via blur
    const bounds = tray.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;

    const views = collector ? buildViewModel(collector.current(), new Date()) : [];
    const currentHeight = views.length === 0 ? 170 : Math.min(POPUP_HEIGHT, Math.max(160, 65 + views.length * 125));
    popup.setSize(POPUP_WIDTH, currentHeight);

    let x: number;
    let y: number;
    if (bounds.width === 0 || bounds.height === 0) {
      x = area.x + area.width - POPUP_WIDTH - 12;
      y = area.y + area.height - currentHeight - 12;
    } else {
      x = Math.min(
        Math.max(Math.round(bounds.x + bounds.width / 2 - POPUP_WIDTH / 2), area.x),
        area.x + area.width - POPUP_WIDTH,
      );
      const opensDown = bounds.y < area.y + area.height / 2;
      y = opensDown ? bounds.y + bounds.height + 8 : bounds.y - currentHeight - 8;
    }

    popup.setPosition(x, Math.min(Math.max(y, area.y), area.y + area.height - currentHeight));
    if (collector) popup.webContents.send('model', views);
    refreshOnOpen(collector);
    shownAt = Date.now();
    popup.show();
    popup.focus();
  };

  app.on('second-instance', () => {
    togglePopup();
  });

  void app.whenReady().then(() => {
    logDebug('whenReady started');
    try {
      collector = createDefaultCollector();
      logDebug('createDefaultCollector completed');
      const initialIcon = iconFor(null);
      logDebug(`icon created: isEmpty=${initialIcon.isEmpty()}, size=${JSON.stringify(initialIcon.getSize())}`);
      tray = new Tray(initialIcon);
      logDebug(`Tray created: bounds=${JSON.stringify(tray.getBounds())}`);
      promoteTrayIcon();
      setTimeout(promoteTrayIcon, 1000);
    } catch (err: any) {
      logDebug(`Error during whenReady setup: ${err?.stack || err}`);
    }
    if (!collector || !tray) {
      logDebug('Initialization failed: collector or tray is null.');
      app.quit();
      return;
    }
    popup = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#1f1f1f',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    void popup.loadFile(path.join(__dirname, 'popup.html'));

    const model = () => (collector ? buildViewModel(collector.current(), new Date()) : []);
    ipcMain.handle('get-model', () => model());
    ipcMain.handle('get-version', () => app.getVersion());
    ipcMain.handle('refresh-now', () => refreshForced(collector));

    popup.on('blur', () => {
      if (Date.now() - shownAt < 250) return; // evita fechamento prematuro por race condition de foco
      popup?.hide();
      hiddenAt = Date.now();
    });

    const render = createSafeRender(() => {
      if (!collector || !tray) return;
      const snaps = collector.current();
      const worst = worstPct(snaps);
      const tip = trayTooltip(snaps);
      logDebug(`render: worst=${worst}, snapsCount=${snaps.length}, tip="${tip}"`);
      tray.setImage(iconFor(worst));
      tray.setToolTip(tip);
      if (popup?.isVisible()) popup.webContents.send('model', model());
    });

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir painel', click: togglePopup },
        { label: 'Atualizar agora', click: () => void refreshForced(collector) },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            if (renderTimer) clearInterval(renderTimer);
            collector?.stop();
            if (tray) {
              tray.destroy();
              tray = null;
            }
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', togglePopup);

    app.on('before-quit', () => {
      if (renderTimer) clearInterval(renderTimer);
      collector?.stop();
      if (tray) {
        tray.destroy();
        tray = null;
      }
    });

    collector.subscribe(render);
    renderTimer = setInterval(render, 30_000); // mantém as contagens regressivas atualizadas
    render();
    void collector.start();
  }).catch((err) => {
    logDebug(`whenReady failed: ${err?.stack || err}`, true);
    app.quit();
  });
}
