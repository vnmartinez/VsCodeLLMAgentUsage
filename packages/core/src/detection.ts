import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function commandExists(binName: string): boolean {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(path.delimiter);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
      : [''];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const target =
        process.platform === 'win32' && !binName.toLowerCase().endsWith(ext)
          ? `${binName}${ext}`
          : binName;
      try {
        if (existsSync(path.join(dir, target))) return true;
      } catch {
        // ignora erros de leitura de permissão
      }
    }
  }
  return false;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isClaudeInstalled(credentialsPath?: string, home = os.homedir()): Promise<boolean> {
  if (credentialsPath && (await pathExists(credentialsPath))) return true;
  if (await pathExists(path.join(home, '.claude'))) return true;
  return commandExists('claude');
}

export async function isCodexInstalled(sessionsDir?: string, home = os.homedir()): Promise<boolean> {
  if (sessionsDir && (await pathExists(path.dirname(sessionsDir)))) return true;
  if (await pathExists(path.join(home, '.codex'))) return true;
  return commandExists('codex');
}

export async function isAntigravityInstalled(home = os.homedir()): Promise<boolean> {
  if (commandExists('agy') || commandExists('antigravity')) return true;
  if (await pathExists(path.join(home, '.gemini'))) return true;
  if (await pathExists(path.join(home, '.antigravity-ide'))) return true;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const appData = process.env.APPDATA ?? '';
    if (
      localAppData &&
      ((await pathExists(path.join(localAppData, 'Programs', 'antigravity'))) ||
        (await pathExists(path.join(localAppData, 'Programs', 'Antigravity IDE'))))
    ) {
      return true;
    }
    if (
      appData &&
      ((await pathExists(path.join(appData, 'Antigravity'))) ||
        (await pathExists(path.join(appData, 'Antigravity IDE'))))
    ) {
      return true;
    }
  } else if (process.platform === 'darwin') {
    if (await pathExists('/Applications/Antigravity.app')) return true;
  }
  return false;
}
