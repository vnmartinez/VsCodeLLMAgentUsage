/** A fonte respondeu num formato desconhecido: não mostrar números. */
export class SourceFormatError extends Error {
  constructor(detail: string) {
    super(`formato da fonte mudou (${detail})`);
    this.name = 'SourceFormatError';
  }
}

/** Não dá para ler agora; o coletor mostra o último valor bom como stale. */
export class StaleError extends Error {
  constructor(note: string) {
    super(note);
    this.name = 'StaleError';
  }
}

/** A fonte não existe agora (processo fechado, sem login, sem sessões). */
export class UnavailableError extends Error {
  constructor(note: string) {
    super(note);
    this.name = 'UnavailableError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}
