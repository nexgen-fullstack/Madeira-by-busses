import { useEffect, useRef, useState } from 'react';
import { Box, Building2, Layers, Map as MapIcon, Mountain, Satellite, Store } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import type { BaseLayer, MapLayers } from '../lib/mapStyles.ts';

const BASES: {
  id: BaseLayer;
  key: 'layers.map' | 'layers.satellite' | 'layers.relief';
  icon: typeof MapIcon;
}[] = [
  { id: 'map', key: 'layers.map', icon: MapIcon },
  { id: 'satellite', key: 'layers.satellite', icon: Satellite },
  { id: 'relief', key: 'layers.relief', icon: Mountain },
];

/** Google-Maps-style layers button: base map plus detail toggles. */
export function LayerSwitcher({
  value,
  onChange,
}: {
  value: MapLayers;
  onChange: (v: MapLayers) => void;
}) {
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const toggles = [
    { key: 'places', label: t.t('layers.places'), icon: Store },
    { key: 'buildings3d', label: t.t('layers.buildings'), icon: Building2 },
    { key: 'terrain3d', label: t.t('layers.terrain'), icon: Box },
  ] as const;

  return (
    <div className="layers" ref={root}>
      <button
        type="button"
        className="layers__button"
        aria-expanded={open}
        aria-label={t.t('layers.title')}
        title={t.t('layers.title')}
        onClick={() => setOpen((o) => !o)}
      >
        <Layers size={20} />
      </button>
      {open && (
        <div className="layers__panel" role="dialog" aria-label={t.t('layers.title')}>
          <div className="layers__title">{t.t('layers.title')}</div>
          <div className="layers__bases" role="radiogroup">
            {BASES.map(({ id, key, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={value.base === id}
                className={`layers__base layers__base--${id}`}
                onClick={() => onChange({ ...value, base: id })}
              >
                <span className="layers__thumb">
                  <Icon size={20} />
                </span>
                <span>{t.t(key)}</span>
              </button>
            ))}
          </div>
          <div className="layers__toggles">
            {toggles.map(({ key, label, icon: Icon }) => (
              <label key={key} className="layers__toggle">
                <Icon size={16} aria-hidden />
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={value[key]}
                  onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
