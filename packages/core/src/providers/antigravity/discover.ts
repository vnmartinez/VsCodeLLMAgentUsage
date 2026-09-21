import { execFile } from 'node:child_process';
import { parseDiscoveryOutput, type LanguageServer } from './parse';

export type RunPowerShell = (script: string) => Promise<string>;

/** Lista language_server.exe com linha de comando e portas em escuta no 127.0.0.1, em JSON. */
export const DISCOVERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$list = @(Get-CimInstance Win32_Process -Filter "Name=\'language_server.exe\'" | ForEach-Object {',
  '  $procId = $_.ProcessId',
  '  [pscustomobject]@{',
  '    pid = $procId',
  '    cmd = $_.CommandLine',
  "    ports = @(Get-NetTCPConnection -OwningProcess $procId -State Listen | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort)",
  '  }',
  '})',
  'ConvertTo-Json -InputObject $list -Depth 3 -Compress',
].join('\n');

export const runPowerShell: RunPowerShell = (script) =>
  new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        // Mensagem genérica: a saída contém a linha de comando, que traz o token.
        if (error) reject(new Error('falha ao consultar processos do Antigravity'));
        else resolve(stdout);
      },
    );
  });

export async function discoverLanguageServers(run: RunPowerShell = runPowerShell): Promise<LanguageServer[]> {
  return parseDiscoveryOutput(await run(DISCOVERY_SCRIPT));
}
