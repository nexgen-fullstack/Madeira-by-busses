import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.ts';

/**
 * Where the sheet rests: its handle alone (the map takes the screen), a strip with the
 * first option (or with what the screen marks `data-peek`: a place's photo and name), half
 * the map, or nearly all of it.
 */
export type SheetSnap = 'min' | 'peek' | 'half' | 'full';

/** The sheet at its lowest (px): the handle alone, above the tab bar. */
export const MIN = 30;
/** The strip's height (px): the handle and the first card. */
const PEEK = 200;
/** Room left above the sheet at its fullest (px), to see there is a map behind. */
const FULL_GAP = 12;
/** A drag shorter than this (px) is a tap on the handle. */
const TAP = 6;

/**
 * The sheet's height for a snap, in a map area `area` px high; `peek`, the height of the
 * strip the screen asks for.
 */
export function snapHeight(snap: SheetSnap, area: number, peek?: number): number {
  if (snap === 'min') return MIN;
  if (snap === 'peek') return Math.min(peek ?? PEEK, area * 0.45);
  if (snap === 'half') return Math.round(area * 0.5);
  return area - FULL_GAP;
}

/**
 * How much of the map's bottom the sheet hides when it rests there (px): the
 * map fits a route above it. At the top the sheet hides nearly all of it, so
 * the route is fitted as if at half height, ready for when it comes down.
 */
export function snapInset(snap: SheetSnap, area: number, peek?: number): number {
  return snapHeight(snap === 'full' ? 'half' : snap, area, peek);
}

/** Of the snaps, the one nearest a height. */
function nearestSnap(height: number, area: number, peek?: number): SheetSnap {
  const snaps: SheetSnap[] = ['min', 'peek', 'half', 'full'];
  const off = (s: SheetSnap) => Math.abs(snapHeight(s, area, peek) - height);
  return snaps.reduce((a, b) => (off(b) < off(a) ? b : a));
}

/**
 * The sheet over the map on a phone, as in a maps app: the map on the whole
 * screen, the screen's content in a sheet that is pulled up and down by its
 * handle (a tap on the handle steps it up, and from the top back to half).
 * Returns the sheet's height and the handle to put at its top.
 */
export function useBottomSheet(
  active: boolean,
  /** The element whose size changes the map area's (the whole app). */
  frame: { current: HTMLElement | null },
  /** The height of the map area: the app less its bars. */
  measureArea: () => number,
  resetKey: string,
  /** Where the sheet rests on a new screen or search. */
  rest: SheetSnap,
  /** Where it rests when the app opens. */
  first: SheetSnap = rest,
  /** The height of the strip the screen asks for, if it does. */
  peek?: number,
) {
  const [snap, setSnap] = useState<SheetSnap>(first);
  const [drag, setDrag] = useState<number>();
  const [areaHeight, setAreaHeight] = useState(0);
  // A new search or another screen: the sheet where that screen wants it.
  const shown = useRef(resetKey);
  useEffect(() => {
    if (shown.current === resetKey) return;
    shown.current = resetKey;
    setSnap(rest);
  }, [resetKey, rest]);
  useEffect(() => {
    const el = frame.current;
    if (!active || !el) return;
    const measure = () => setAreaHeight(measureArea());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, frame, measureArea]);
  const height = drag ?? snapHeight(snap, areaHeight, peek);
  return { snap, setSnap, height, dragging: drag !== undefined, areaHeight, setDrag };
}

interface HandleProps {
  height: number;
  areaHeight: number;
  peek?: number;
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  onDrag: (height: number | undefined) => void;
}

/** The grip at the top of the sheet: drag it, or tap it to step the sheet up. */
export function SheetHandle({ height, areaHeight, peek, snap, onSnap, onDrag }: HandleProps) {
  const t = useI18n();
  const start = useRef<{ y: number; height: number; moved: boolean }>(undefined);
  const end = useCallback(
    (y: number) => {
      const s = start.current;
      start.current = undefined;
      if (!s) return;
      onDrag(undefined);
      if (!s.moved) {
        onSnap(snap === 'half' ? 'full' : 'half');
        return;
      }
      onSnap(nearestSnap(s.height + (s.y - y), areaHeight, peek));
    },
    [areaHeight, peek, onDrag, onSnap, snap],
  );
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={t.t(snap === 'full' ? 'panel.lower' : 'panel.raise')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, height, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dy = s.y - e.clientY;
        if (!s.moved && Math.abs(dy) < TAP) return;
        s.moved = true;
        onDrag(Math.max(MIN, Math.min(areaHeight, s.height + dy)));
      }}
      onPointerUp={(e) => end(e.clientY)}
      onPointerCancel={(e) => end(e.clientY)}
    >
      <span aria-hidden />
    </button>
  );
}
