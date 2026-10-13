import { describe, expect, it, vi } from 'vitest';
import { refreshForced, refreshOnOpen } from '../src/refresh';

describe('refresh', () => {
  it('refreshOnOpen chama refreshNow sem argumentos', () => {
    const c = { refreshNow: vi.fn(async () => {}) };
    refreshOnOpen(c);
    expect(c.refreshNow).toHaveBeenCalledTimes(1);
    expect(c.refreshNow).toHaveBeenCalledWith();
  });

  it('refreshOnOpen aceita null', () => {
    expect(() => refreshOnOpen(null)).not.toThrow();
  });

  it('refreshOnOpen engole rejeição', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    refreshOnOpen({ refreshNow: async () => { throw new Error('x'); } });
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('refreshForced força a coleta', () => {
    const c = { refreshNow: vi.fn(async () => {}) };
    void refreshForced(c);
    expect(c.refreshNow).toHaveBeenCalledWith({ force: true });
    expect(refreshForced(null)).toBeUndefined();
  });
});
