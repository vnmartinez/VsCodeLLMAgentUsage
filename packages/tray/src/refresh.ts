export interface Refreshable {
  refreshNow(opts?: { force?: boolean }): Promise<void>;
}

/** Ao abrir o painel: coleta sem forçar (respeita cooldown/429); o popup re-renderiza via subscribe. */
export function refreshOnOpen(c: Refreshable | null): void {
  void c?.refreshNow().catch(() => undefined);
}

/** Botão/menu "Atualizar": coleta real, ignorando o cooldown. */
export function refreshForced(c: Refreshable | null): Promise<void> | undefined {
  return c?.refreshNow({ force: true });
}
