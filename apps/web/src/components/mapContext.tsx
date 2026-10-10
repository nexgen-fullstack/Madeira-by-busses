import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LatLon } from '@madeirabus/engine';
import { EMPTY_CONTENT, type MapContent } from '../lib/mapContent.ts';

/** The planner field waiting for a tap on the map. */
export type PickField = 'from' | 'to';

/** A town or village chosen with nowhere in it to go to: its bounds, to put the pin in. */
export interface PickArea {
  name: string;
  rings: LatLon[][];
}

/** A stop tapped in a list: the map goes to it and makes it stand out. */
export interface Spotlight extends LatLon {
  name: string;
}

/** Map content lives in a tiny module so the heavy map library can load lazily. */
interface MapCtx {
  content: MapContent;
  setContent: (c: MapContent) => void;
  pick?: PickField;
  /** Outlined on the map while the pin is put down, when a village asks for it. */
  pickArea?: PickArea;
  /** Where the pin starts, when the screen asking knows better than the planner's fields. */
  pickStart?: LatLon;
  setPick: (field: PickField | undefined, area?: PickArea, start?: LatLon) => void;
  spotlight?: Spotlight;
  setSpotlight: (spot: Spotlight | undefined) => void;
}
export const MapContentContext = createContext<MapCtx>({
  content: EMPTY_CONTENT,
  setContent: () => {},
  setPick: () => {},
  setSpotlight: () => {},
});

export function MapProvider({ children }: { children: ReactNode }) {
  const [content, setContentState] = useState<MapContent>(EMPTY_CONTENT);
  const [spotlight, setSpotlight] = useState<Spotlight | undefined>();
  // Another screen's map: the stop tapped on the last one no longer stands out.
  const setContent = useCallback((c: MapContent) => {
    setContentState(c);
    setSpotlight(undefined);
  }, []);
  const [pick, setPickField] = useState<PickField | undefined>();
  const [pickArea, setPickArea] = useState<PickArea | undefined>();
  const [pickStart, setPickStart] = useState<LatLon | undefined>();
  const setPick = useCallback((field: PickField | undefined, area?: PickArea, start?: LatLon) => {
    setPickField(field);
    setPickArea(field ? area : undefined);
    setPickStart(field && start ? { lat: start.lat, lon: start.lon } : undefined);
  }, []);
  return (
    <MapContentContext.Provider
      value={{ content, setContent, pick, pickArea, pickStart, setPick, spotlight, setSpotlight }}
    >
      {children}
    </MapContentContext.Provider>
  );
}

/** Puts `content` on the map while the calling screen is shown. */
export function useMapContent(content: MapContent | undefined): void {
  const { setContent } = useContext(MapContentContext);
  useEffect(() => {
    if (content) setContent(content);
  }, [content, setContent]);
}

/**
 * Shows a stop of a list on the map: it flies there and the stop pulses, named; the same
 * stop tapped again stops standing out. `isShown` tells the stop shown.
 */
export function useSpotlight(): {
  show: (spot: Spotlight) => void;
  isShown: (p: LatLon) => boolean;
} {
  const { spotlight, setSpotlight } = useContext(MapContentContext);
  const isShown = useCallback(
    (p: LatLon) => spotlight !== undefined && spotlight.lat === p.lat && spotlight.lon === p.lon,
    [spotlight],
  );
  const show = useCallback(
    (spot: Spotlight) => setSpotlight(isShown(spot) ? undefined : spot),
    [isShown, setSpotlight],
  );
  return { show, isShown };
}
