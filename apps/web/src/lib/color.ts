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

/** sRGB channel (0–1) to linear light, and back. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A colour as OKLCH: perceived lightness, chroma and hue (radians). */
function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH to sRGB channels (0–1), which may lie outside the gamut. */
function fromOklch(L: number, C: number, h: number): [number, number, number] {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear) as [number, number, number];
}

/** Lightness and chroma the lines are shown within: deep enough for white type, never neon. */
const LINE_L = [0.33, 0.58] as const;
const LINE_C = 0.15;

/**
 * A line's colour as the app shows it: the operator's hue, its lightness and
 * colourfulness brought into one calm range, so the lines sit together with the
 * app's navy and blues and take white numbers (the feeds' magenta, lime and
 * yellow come out raspberry, olive and ochre; their navy and blue stay as they are).
 */
export function lineColor(hex: string): string {
  const [L0, C0, h] = toOklch(hex);
  const L = Math.min(LINE_L[1], Math.max(LINE_L[0], L0));
  let C = Math.min(C0, LINE_C);
  // Into the sRGB gamut by giving up chroma, never hue or lightness.
  for (let i = 0; i < 30; i++) {
    const rgb = fromOklch(L, C, h);
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) return toHex(rgb.map((v) => v * 255));
    C *= 0.9;
  }
  return toHex(fromOklch(L, 0, h).map((v) => v * 255));
}

const shown = new Map<string, string>();

/** The colour a route (its feed colour, "RRGGBB") is shown in everywhere in the app. */
export function routeColor(route: { color: string }): string {
  let c = shown.get(route.color);
  if (!c) {
    c = lineColor(`#${route.color}`);
    shown.set(route.color, c);
  }
  return c;
}
