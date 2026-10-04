/** Colour arithmetic for line colours, which come from the operators' feeds. */

const DARK = '#14181F';
const WHITE = '#FFFFFF';

function channels(hex: string): [number, number, number] {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(c: number[]): string {
  return `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour for a line's badge: the feed's own when it reads, otherwise
 * white or near-black. Feeds often ask for white on light green or yellow.
 */
export function readableOn(bg: string, preferred = WHITE): string {
  if (contrast(preferred, bg) >= 2.6) return preferred;
  return contrast(WHITE, bg) >= contrast(DARK, bg) ? WHITE : DARK;
}

/** `hex` mixed into white: 0 is white, 1 the colour itself. */
export function tint(hex: string, amount: number): string {
  return toHex(channels(hex).map((v) => 255 + (v - 255) * amount));
}

/** A shade of `hex` that reads as text on `bg`, darkened (or lightened) as little as needed. */
export function inkOn(hex: string, bg: string, ratio = 4.5): string {
  const towards = luminance(bg) > 0.4 ? 0 : 255;
  const c = channels(hex);
  for (let step = 0; step <= 20; step++) {
    const mixed = toHex(c.map((v) => v + (towards - v) * (step / 20)));
    if (contrast(mixed, bg) >= ratio) return mixed;
  }
  return towards === 0 ? DARK : WHITE;
}
