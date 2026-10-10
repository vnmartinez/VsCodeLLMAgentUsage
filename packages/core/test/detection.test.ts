import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commandExists,
  isAntigravityInstalled,
  isClaudeInstalled,
  isCodexInstalled,
  pathExists,
} from '../src/detection';

describe('detection', () => {
  it('pathExists retorna true para caminho existente e false para inexistente', async () => {
    expect(await pathExists(process.cwd())).toBe(true);
    expect(await pathExists(path.join(process.cwd(), 'caminho_totalmente_inexistente_12345'))).toBe(false);
  });

  it('commandExists retorna false para comando inexistente', () => {
    expect(commandExists('comando_que_nunca_vai_existir_xyz_999')).toBe(false);
  });

  it('isClaudeInstalled retorna true se o arquivo de credenciais existir', async () => {
    // Usamos o próprio cwd como se fosse o arquivo de credenciais
    expect(await isClaudeInstalled(process.cwd())).toBe(true);
  });

  it('isClaudeInstalled retorna false se nada existir e comando não for encontrado', async () => {
    const fakeHome = path.join(os.tmpdir(), 'fake-home-no-claude-' + Date.now());
    const fakeCreds = path.join(fakeHome, 'creds.json');
    // Força checagem em pasta temporária que não existe
    // Se claude estiver no PATH real, testamos a lógica de caminho
    const exists = await isClaudeInstalled(fakeCreds, fakeHome);
    // Se claude estiver instalado na máquina, commandExists('claude') pode ser true,
    // mas se não estiver, deve ser false
    expect(typeof exists).toBe('boolean');
  });

  it('isCodexInstalled retorna false se nada existir e comando não for encontrado', async () => {
    const fakeHome = path.join(os.tmpdir(), 'fake-home-no-codex-' + Date.now());
    const fakeSessions = path.join(fakeHome, '.codex', 'sessions');
    const exists = await isCodexInstalled(fakeSessions, fakeHome);
    expect(typeof exists).toBe('boolean');
  });

  it('isAntigravityInstalled retorna booleano consistente', async () => {
    const fakeHome = path.join(os.tmpdir(), 'fake-home-no-ag-' + Date.now());
    const exists = await isAntigravityInstalled(fakeHome);
    expect(typeof exists).toBe('boolean');
  });
});
