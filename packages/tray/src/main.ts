import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { band, buildViewModel, createDefaultCollector, worstPct } from '@agent-usage/core';
import { ICON_SIZE, renderIconBitmap } from './icon';
import { createSafeRender } from './render';
import { trayTooltip } from './tooltip';

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
  app.quit();
} else {
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

    let x: number;
    let y: number;
    if (bounds.width === 0 || bounds.height === 0) {
      x = area.x + area.width - POPUP_WIDTH - 12;
      y = area.y + area.height - POPUP_HEIGHT - 12;
    } else {
      x = Math.min(
        Math.max(Math.round(bounds.x + bounds.width / 2 - POPUP_WIDTH / 2), area.x),
        area.x + area.width - POPUP_WIDTH,
      );
      const opensDown = bounds.y < area.y + area.height / 2;
      y = opensDown ? bounds.y + bounds.height + 8 : bounds.y - POPUP_HEIGHT - 8;
    }

    popup.setPosition(x, Math.min(Math.max(y, area.y), area.y + area.height - POPUP_HEIGHT));
    if (collector) popup.webContents.send('model', buildViewModel(collector.current(), new Date()));
    shownAt = Date.now();
    popup.show();
    popup.focus();
    void collector?.refreshNow();
  };

  app.on('second-instance', () => {
    togglePopup();
  });

  void app.whenReady().then(() => {
    collector = createDefaultCollector();
    tray = new Tray(iconFor(null));
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
    ipcMain.handle('refresh-now', () => collector?.refreshNow());

    popup.on('blur', () => {
      if (Date.now() - shownAt < 250) return; // evita fechamento prematuro por race condition de foco
      popup?.hide();
      hiddenAt = Date.now();
    });

    const render = createSafeRender(() => {
      if (!collector || !tray) return;
      const snaps = collector.current();
      tray.setImage(iconFor(worstPct(snaps)));
      tray.setToolTip(trayTooltip(snaps));
      if (popup?.isVisible()) popup.webContents.send('model', model());
    });

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir painel', click: togglePopup },
        { label: 'Atualizar agora', click: () => void collector?.refreshNow() },
        {
          label: 'Iniciar com o Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
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
  });
}
