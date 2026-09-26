import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { band, buildViewModel, createDefaultCollector, worstPct } from '@agent-usage/core';
import { ICON_SIZE, renderIconBitmap } from './icon';
import { trayTooltip } from './tooltip';

const POPUP_WIDTH = 340;
const POPUP_HEIGHT = 460;

function iconFor(pct: number | null) {
  const bitmap = renderIconBitmap(pct, pct === null ? null : band(pct));
  return nativeImage.createFromBitmap(bitmap, { width: ICON_SIZE, height: ICON_SIZE, scaleFactor: 2 });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // App de bandeja: continua rodando sem janelas visíveis.
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    const collector = createDefaultCollector();
    const tray = new Tray(iconFor(null));
    const popup = new BrowserWindow({
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

    const model = () => buildViewModel(collector.current(), new Date());
    ipcMain.handle('get-model', () => model());

    let hiddenAt = 0;
    popup.on('blur', () => {
      popup.hide();
      hiddenAt = Date.now();
    });

    const render = () => {
      const snaps = collector.current();
      tray.setImage(iconFor(worstPct(snaps)));
      tray.setToolTip(trayTooltip(snaps));
      if (popup.isVisible()) popup.webContents.send('model', model());
    };

    const togglePopup = () => {
      if (popup.isVisible()) {
        popup.hide();
        return;
      }
      if (Date.now() - hiddenAt < 250) return; // este clique acabou de fechar o popup via blur
      const bounds = tray.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const x = Math.min(
        Math.max(Math.round(bounds.x + bounds.width / 2 - POPUP_WIDTH / 2), area.x),
        area.x + area.width - POPUP_WIDTH,
      );
      const opensDown = bounds.y < area.y + area.height / 2;
      const y = opensDown ? bounds.y + bounds.height + 8 : bounds.y - POPUP_HEIGHT - 8;
      popup.setPosition(x, Math.min(Math.max(y, area.y), area.y + area.height - POPUP_HEIGHT));
      popup.webContents.send('model', model());
      popup.show();
      popup.focus();
    };

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Atualizar agora', click: () => void collector.refreshNow() },
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
            collector.stop();
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', togglePopup);

    collector.subscribe(render);
    setInterval(render, 30_000); // mantém as contagens regressivas atualizadas
    render();
    void collector.start();
  });
}
