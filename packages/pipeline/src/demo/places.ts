import type { BPlace } from '@madeirabus/engine';

/**
 * A few well-known places for the demo network, with their names in the
 * app's languages, so place search works without OpenStreetMap data.
 * Positions are approximate, like the demo stops.
 */
export const DEMO_PLACES: BPlace[] = [
  {
    name: 'Aeroporto da Madeira',
    lat: 32.6942,
    lon: -16.7781,
    kind: 'aerodrome',
    names: {
      en: 'Madeira Airport',
      uk: 'Аеропорт Мадейри',
      ru: 'Аэропорт Мадейры',
      de: 'Flughafen Madeira',
      es: 'Aeropuerto de Madeira',
      it: 'Aeroporto di Madeira',
      cs: 'Letiště Madeira',
      pl: 'Port lotniczy Madera',
      alt_name: 'Aeroporto Cristiano Ronaldo',
    },
  },
  {
    name: 'Mercado dos Lavradores',
    lat: 32.6487,
    lon: -16.9036,
    kind: 'marketplace',
    names: {
      en: "Farmers' Market",
      uk: 'Ринок Меркаду-душ-Лаврадореш',
      ru: 'Рынок Меркаду-дуж-Лаврадореш',
      de: 'Bauernmarkt',
    },
  },
  {
    name: 'Teleférico do Funchal',
    lat: 32.6481,
    lon: -16.9012,
    kind: 'cable_car',
    names: {
      en: 'Funchal Cable Car',
      uk: 'Канатна дорога Фуншала',
      ru: 'Канатная дорога Фуншала',
      de: 'Seilbahn Funchal',
      es: 'Teleférico de Funchal',
      it: 'Funivia di Funchal',
      cs: 'Lanovka Funchal',
      pl: 'Kolejka linowa Funchal',
    },
  },
  {
    name: 'Cabo Girão',
    lat: 32.6553,
    lon: -17.0047,
    kind: 'viewpoint',
    names: { uk: 'Кабу-Жиран', ru: 'Кабу-Жиран' },
  },
  {
    name: 'Pico do Arieiro',
    lat: 32.7356,
    lon: -16.9286,
    kind: 'peak',
    names: { uk: 'Піку-ду-Арієйру', ru: 'Пику-ду-Арейру' },
  },
  {
    name: 'Praia Formosa',
    lat: 32.6385,
    lon: -16.956,
    kind: 'beach',
    names: { uk: 'Пляж Прайя-Формоза', ru: 'Пляж Прайя-Формоза' },
  },
];
