import type { Band } from '@agent-usage/core';

export const ICON_SIZE = 32;

/** Fonte 3x5: '1' = pixel aceso. */
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'],
};

/** RGB por faixa; 'none' = sem dado. */
const COLORS: Record<Band | 'none', [number, number, number]> = {
  normal: [0x2e, 0x9e, 0x5b],
  warning: [0xd9, 0xa4, 0x00],
  critical: [0xd9, 0x3a, 0x3a],
  none: [0x6b, 0x6b, 0x6b],
};

export function iconLabel(pct: number | null): string {
  return pct === null ? '--' : String(Math.min(100, Math.max(0, Math.round(pct))));
}

/** Bitmap BGRA (formato do nativeImage.createFromBitmap no Windows). */
export function renderIconBitmap(pct: number | null, band: Band | null): Buffer {
  const buf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  const fill = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    const i = (y * ICON_SIZE + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = 255;
  };

  const background = COLORS[band ?? 'none'];
  for (let y = 0; y < ICON_SIZE; y++) for (let x = 0; x < ICON_SIZE; x++) fill(x, y, background);

  const text = iconLabel(pct);
  const scale = text.length >= 3 ? 2 : 3;
  const gap = scale;
  const width = text.length * 3 * scale + (text.length - 1) * gap;
  const x0 = Math.floor((ICON_SIZE - width) / 2);
  const y0 = Math.floor((ICON_SIZE - 5 * scale) / 2);

  [...text].forEach((char, index) => {
    const glyph = FONT[char];
    const gx = x0 + index * (3 * scale + gap);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) fill(gx + col * scale + dx, y0 + row * scale + dy, [255, 255, 255]);
        }
      }
    }
  });
  return buf;
}
