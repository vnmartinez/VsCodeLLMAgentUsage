import { describe, expect, it } from 'vitest';
import { ICON_SIZE, iconLabel, renderIconBitmap } from '../src/icon';

function pixel(buf: Buffer, x: number, y: number): number[] {
  const i = (y * ICON_SIZE + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; // B, G, R, A
}

const WHITE = [255, 255, 255, 255];

describe('iconLabel', () => {
  it('arredonda, limita a 0–100 e usa -- sem dado', () => {
    expect(iconLabel(57.6)).toBe('58');
    expect(iconLabel(130)).toBe('100');
    expect(iconLabel(null)).toBe('--');
  });

  it('retorna -- e renderiza sem erro para NaN ou valores não finitos', () => {
    expect(iconLabel(NaN)).toBe('--');
    expect(iconLabel(Infinity)).toBe('--');
    expect(() => renderIconBitmap(NaN, null)).not.toThrow();
  });
});

describe('renderIconBitmap', () => {
  it('gera BGRA 32x32 com o fundo na cor da faixa', () => {
    expect(renderIconBitmap(8, 'normal')).toHaveLength(ICON_SIZE * ICON_SIZE * 4);
    expect(pixel(renderIconBitmap(8, 'normal'), 0, 0)).toEqual([0x5b, 0x9e, 0x2e, 255]);
    expect(pixel(renderIconBitmap(85, 'warning'), 0, 0)).toEqual([0x00, 0xa4, 0xd9, 255]);
    expect(pixel(renderIconBitmap(99, 'critical'), 0, 0)).toEqual([0x3a, 0x3a, 0xd9, 255]);
    expect(pixel(renderIconBitmap(null, null), 0, 0)).toEqual([0x6b, 0x6b, 0x6b, 255]);
  });

  it('desenha um dígito centralizado em escala 3', () => {
    // "8": 9x15 px, começa em (11, 8); a primeira linha do glifo é cheia
    const buf = renderIconBitmap(8, 'normal');
    expect(pixel(buf, 11, 8)).toEqual(WHITE);
    expect(pixel(buf, 10, 8)).not.toEqual(WHITE);
  });

  it('desenha três dígitos em escala 2', () => {
    // "100": 22x10 px, começa em (5, 11); o "1" tem só a coluna do meio na primeira linha
    const buf = renderIconBitmap(100, 'critical');
    expect(pixel(buf, 7, 11)).toEqual(WHITE);
    expect(pixel(buf, 5, 11)).not.toEqual(WHITE);
  });
});
