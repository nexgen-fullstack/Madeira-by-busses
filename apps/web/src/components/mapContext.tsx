import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EMPTY_CONTENT, type MapContent } from '../lib/mapContent.ts';

/** The planner field waiting for a tap on the map. */
export type PickField = 'from' | 'to';

/** Map content lives in a tiny module so the heavy map library can load lazily. */
interface MapCtx {
  content: MapContent;
  setContent: (c: MapContent) => void;
  pick?: PickField;
  setPick: (field: PickField | undefined) => void;
}
export const MapContentContext = createContext<MapCtx>({
  content: EMPTY_CONTENT,
  setContent: () => {},
  setPick: () => {},
});

export function MapProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<MapContent>(EMPTY_CONTENT);
  const [pick, setPick] = useState<PickField | undefined>();
  return (
    <MapContentContext.Provider value={{ content, setContent, pick, setPick }}>
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
