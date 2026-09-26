import { describe, expect, it, vi } from 'vitest';
import { createSafeRender } from '../src/render';

describe('createSafeRender', () => {
  it('executa a renderização com sucesso', () => {
    const fn = vi.fn();
    const safe = createSafeRender(fn);
    safe();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('captura qualquer erro lançado pelo render sem propagar exceção para o setInterval', () => {
    const throwingFn = () => {
      throw new TypeError("Cannot read properties of undefined (reading '0')");
    };
    const onError = vi.fn();
    const safe = createSafeRender(throwingFn, onError);

    expect(() => safe()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
  });
});
