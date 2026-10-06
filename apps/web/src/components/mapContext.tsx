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

/** Map content lives in a tiny module so the heavy map library can load lazily. */
interface MapCtx {
  content: MapContent;
  setContent: (c: MapContent) => void;
  pick?: PickField;
  /** Outlined on the map while the pin is put down, when a village asks for it. */
  pickArea?: PickArea;
  setPick: (field: PickField | undefined, area?: PickArea) => void;
}
export const MapContentContext = createContext<MapCtx>({
  content: EMPTY_CONTENT,
  setContent: () => {},
  setPick: () => {},
});

export function MapProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<MapContent>(EMPTY_CONTENT);
  const [pick, setPickField] = useState<PickField | undefined>();
  const [pickArea, setPickArea] = useState<PickArea | undefined>();
  const setPick = useCallback((field: PickField | undefined, area?: PickArea) => {
    setPickField(field);
    setPickArea(field ? area : undefined);
  }, []);
  return (
    <MapContentContext.Provider value={{ content, setContent, pick, pickArea, setPick }}>
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
