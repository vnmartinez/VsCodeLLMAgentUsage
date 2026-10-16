import { execFile } from 'node:child_process';
import { UnavailableError } from '../../errors';

/** Modo de impressão do agy (não abre TUI); mesmos argumentos usados pelo Orca. */
export const AGY_ARGS = ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'];

/** O agy leva ~4 s (consulta de cota na nuvem); folga para máquina/rede lenta, abaixo do timeout do coletor. */
export const AGY_TIMEOUT_MS = 10_000;

export type RunAgy = (signal?: AbortSignal) => Promise<string>;

export const runAgy: RunAgy = (signal) =>
  new Promise((resolve, reject) => {
    execFile(
      'agy',
      AGY_ARGS,
      { windowsHide: true, timeout: AGY_TIMEOUT_MS, maxBuffer: 1024 * 1024, signal },
      (error, stdout) => {
        // Mensagem genérica: o erro do agy pode trazer credencial ou conteúdo da conta.
        if (error) reject(new UnavailableError('agy não respondeu ao /usage', true));
        else resolve(stdout);
      },
    );
  });
