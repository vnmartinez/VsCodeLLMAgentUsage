export function buildPromoteScript(exePath: string): string {
  return `
    $target = '${exePath.replace(/'/g, "''")}';
    $base = 'HKCU:\\Control Panel\\NotifyIconSettings';
    Get-ChildItem -Path $base -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath;
      if ($p.ExecutablePath -eq $target -and $p.IsPromoted -ne 1) {
        Set-ItemProperty -Path $_.PSPath -Name 'IsPromoted' -Value 1 -Type DWord -Force;
      }
    }
  `;
}
