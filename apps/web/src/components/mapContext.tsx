import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EMPTY_CONTENT, type MapContent } from '../lib/mapContent.ts';

/** Map content lives in a tiny module so the heavy map library can load lazily. */
interface MapCtx {
  content: MapContent;
  setContent: (c: MapContent) => void;
}
export const MapContentContext = createContext<MapCtx>({
  content: EMPTY_CONTENT,
  setContent: () => {},
});

export function MapProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<MapContent>(EMPTY_CONTENT);
  return (
    <MapContentContext.Provider value={{ content, setContent }}>
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
