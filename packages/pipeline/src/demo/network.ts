/**
 * DEMO NETWORK — synthetic data for development, tests and demos.
 *
 * Place names and municipalities are real and coordinates are approximate,
 * but route codes (all prefixed "D") and every timetable below are invented.
 * The app labels a demo bundle prominently. Real timetables come from the
 * operators' feeds through the nightly pipeline (see docs/data.md).
 */

export interface DemoStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Municipality code. */
  muni: string;
  /** Approximate elevation (m). */
  ele: number;
}

export type Schedule = { every: [first: string, last: string, minutes: number] } | { at: string[] };

export interface DemoRoute {
  id: string;
  agency: 'HF' | 'CAM' | 'RDO' | 'AERO';
  short: string;
  long: string;
  color: string;
  text: string;
  /** [stop id, minutes from the first stop] */
  stops: [string, number][];
  weekday: Schedule;
  saturday: Schedule;
  sunday: Schedule;
}

export const DEMO_AGENCIES = [
  { id: 'HF', name: 'Horários do Funchal', url: 'https://www.horariosdofunchal.pt' },
  { id: 'CAM', name: 'Companhia de Autocarros da Madeira', url: 'https://siga.madeira.gov.pt' },
  { id: 'RDO', name: 'SIGA Rodoeste', url: 'https://www.rodoeste.pt' },
  { id: 'AERO', name: 'Aerobus', url: 'https://siga.madeira.gov.pt' },
] as const;

export const DEMO_STOPS: DemoStop[] = [
  // Funchal
  {
    id: 'FNC_AVMAR',
    name: 'Funchal (Avenida do Mar)',
    lat: 32.6462,
    lon: -16.9072,
    muni: 'FNC',
    ele: 5,
  },
  {
    id: 'FNC_MERC',
    name: 'Mercado dos Lavradores',
    lat: 32.6496,
    lon: -16.9037,
    muni: 'FNC',
    ele: 15,
  },
  {
    id: 'FNC_INFANTE',
    name: 'Rotunda do Infante',
    lat: 32.6449,
    lon: -16.9157,
    muni: 'FNC',
    ele: 40,
  },
  { id: 'FNC_LIDO', name: 'Lido', lat: 32.6371, lon: -16.9363, muni: 'FNC', ele: 30 },
  { id: 'FNC_FORUM', name: 'Fórum Madeira', lat: 32.6339, lon: -16.9468, muni: 'FNC', ele: 25 },
  {
    id: 'FNC_HOSP',
    name: 'Hospital Dr. Nélio Mendonça',
    lat: 32.6553,
    lon: -16.9266,
    muni: 'FNC',
    ele: 130,
  },
  { id: 'FNC_MONTE', name: 'Monte', lat: 32.6766, lon: -16.9022, muni: 'FNC', ele: 550 },
  // Câmara de Lobos
  { id: 'CML_CENTRO', name: 'Câmara de Lobos', lat: 32.6489, lon: -16.9773, muni: 'CML', ele: 20 },
  {
    id: 'CML_ESTREITO',
    name: 'Estreito de Câmara de Lobos',
    lat: 32.6668,
    lon: -16.9787,
    muni: 'CML',
    ele: 450,
  },
  { id: 'CML_GIRAO', name: 'Cabo Girão', lat: 32.656, lon: -17.0047, muni: 'CML', ele: 580 },
  { id: 'CML_EIRA', name: 'Eira do Serrado', lat: 32.7118, lon: -16.9614, muni: 'CML', ele: 1060 },
  {
    id: 'CML_CURRAL',
    name: 'Curral das Freiras',
    lat: 32.7206,
    lon: -16.9696,
    muni: 'CML',
    ele: 640,
  },
  // Ribeira Brava
  { id: 'RBR_CENTRO', name: 'Ribeira Brava', lat: 32.6735, lon: -17.0638, muni: 'RBR', ele: 10 },
  { id: 'RBR_SERRA', name: 'Serra de Água', lat: 32.7262, lon: -17.0273, muni: 'RBR', ele: 500 },
  { id: 'RBR_ENCUM', name: 'Encumeada', lat: 32.754, lon: -17.0208, muni: 'RBR', ele: 1000 },
  // Ponta do Sol
  { id: 'PSO_CENTRO', name: 'Ponta do Sol', lat: 32.6808, lon: -17.1004, muni: 'PSO', ele: 10 },
  {
    id: 'PSO_MADALENA',
    name: 'Madalena do Mar',
    lat: 32.6997,
    lon: -17.1367,
    muni: 'PSO',
    ele: 20,
  },
  // Calheta
  { id: 'CLT_CENTRO', name: 'Calheta', lat: 32.7213, lon: -17.1769, muni: 'CLT', ele: 10 },
  { id: 'CLT_PRAZERES', name: 'Prazeres', lat: 32.757, lon: -17.204, muni: 'CLT', ele: 620 },
  { id: 'CLT_PAUL', name: 'Paul do Mar', lat: 32.757, lon: -17.2262, muni: 'CLT', ele: 10 },
  // Porto Moniz
  { id: 'PMZ_SEIXAL', name: 'Seixal', lat: 32.824, lon: -17.1098, muni: 'PMZ', ele: 50 },
  { id: 'PMZ_CENTRO', name: 'Porto Moniz', lat: 32.8667, lon: -17.1697, muni: 'PMZ', ele: 10 },
  // São Vicente
  { id: 'SVC_CENTRO', name: 'São Vicente', lat: 32.7966, lon: -17.0432, muni: 'SVC', ele: 30 },
  // Santana
  { id: 'STN_RFRIO', name: 'Ribeiro Frio', lat: 32.7349, lon: -16.8869, muni: 'STN', ele: 870 },
  { id: 'STN_FAIAL', name: 'Faial', lat: 32.7894, lon: -16.8566, muni: 'STN', ele: 150 },
  { id: 'STN_CENTRO', name: 'Santana', lat: 32.8058, lon: -16.882, muni: 'STN', ele: 430 },
  // Machico
  { id: 'MCH_CENTRO', name: 'Machico', lat: 32.718, lon: -16.7668, muni: 'MCH', ele: 10 },
  { id: 'MCH_CANICAL', name: 'Caniçal', lat: 32.7385, lon: -16.7383, muni: 'MCH', ele: 30 },
  {
    id: 'MCH_ABRA',
    name: "Baía d'Abra (Ponta de São Lourenço)",
    lat: 32.7432,
    lon: -16.7068,
    muni: 'MCH',
    ele: 50,
  },
  { id: 'MCH_PCRUZ', name: 'Porto da Cruz', lat: 32.771, lon: -16.827, muni: 'MCH', ele: 50 },
  // Santa Cruz
  {
    id: 'SCR_AERO',
    name: 'Aeroporto da Madeira',
    lat: 32.6942,
    lon: -16.7781,
    muni: 'SCR',
    ele: 50,
  },
  { id: 'SCR_CENTRO', name: 'Santa Cruz', lat: 32.6878, lon: -16.7925, muni: 'SCR', ele: 15 },
  { id: 'SCR_CANICO', name: 'Caniço', lat: 32.6519, lon: -16.8394, muni: 'SCR', ele: 200 },
  { id: 'SCR_GARAJAU', name: 'Garajau', lat: 32.6404, lon: -16.8518, muni: 'SCR', ele: 120 },
  { id: 'SCR_CAMACHA', name: 'Camacha', lat: 32.6787, lon: -16.8436, muni: 'SCR', ele: 700 },
  { id: 'SCR_STSERRA', name: 'Santo da Serra', lat: 32.7273, lon: -16.8146, muni: 'SCR', ele: 680 },
];

const HF = { color: 'F2A900', text: '1A1A1A' };
const HF_INTERURBAN = { color: 'E07B00', text: 'FFFFFF' };
const CAM = { color: '2E7D32', text: 'FFFFFF' };
const RDO = { color: '1565C0', text: 'FFFFFF' };
const AERO = { color: '6A1B9A', text: 'FFFFFF' };

export const DEMO_ROUTES: DemoRoute[] = [
  {
    id: 'D1',
    agency: 'HF',
    short: 'D1',
    long: 'Fórum Madeira – Lido – Centro – Mercado',
    ...HF,
    stops: [
      ['FNC_FORUM', 0],
      ['FNC_LIDO', 5],
      ['FNC_INFANTE', 12],
      ['FNC_AVMAR', 16],
      ['FNC_MERC', 20],
    ],
    weekday: { every: ['06:30', '23:30', 15] },
    saturday: { every: ['07:00', '23:00', 20] },
    sunday: { every: ['07:30', '22:30', 30] },
  },
  {
    id: 'D2',
    agency: 'HF',
    short: 'D2',
    long: 'Centro – Monte',
    ...HF,
    stops: [
      ['FNC_AVMAR', 0],
      ['FNC_MERC', 4],
      ['FNC_MONTE', 25],
    ],
    weekday: { every: ['07:00', '22:00', 30] },
    saturday: { every: ['07:30', '21:30', 30] },
    sunday: { every: ['08:00', '20:00', 60] },
  },
  {
    id: 'D3',
    agency: 'HF',
    short: 'D3',
    long: 'Centro – Hospital',
    ...HF,
    stops: [
      ['FNC_AVMAR', 0],
      ['FNC_INFANTE', 5],
      ['FNC_HOSP', 15],
    ],
    weekday: { every: ['06:45', '22:45', 20] },
    saturday: { every: ['07:00', '22:00', 30] },
    sunday: { every: ['07:30', '21:30', 40] },
  },
  {
    id: 'D81',
    agency: 'HF',
    short: 'D81',
    long: 'Funchal – Eira do Serrado – Curral das Freiras',
    ...HF_INTERURBAN,
    stops: [
      ['FNC_AVMAR', 0],
      ['FNC_HOSP', 12],
      ['CML_EIRA', 38],
      ['CML_CURRAL', 55],
    ],
    weekday: { every: ['07:30', '19:30', 120] },
    saturday: { every: ['08:30', '18:30', 120] },
    sunday: { at: ['09:30', '13:30', '17:30'] },
  },
  {
    id: 'D56',
    agency: 'HF',
    short: 'D56',
    long: 'Funchal – Ribeiro Frio – Faial – Santana',
    ...HF_INTERURBAN,
    stops: [
      ['FNC_MERC', 0],
      ['STN_RFRIO', 45],
      ['STN_FAIAL', 70],
      ['STN_CENTRO', 85],
    ],
    weekday: { at: ['07:45', '10:15', '13:00', '16:00', '18:30'] },
    saturday: { at: ['08:30', '13:00', '17:30'] },
    sunday: { at: ['09:00', '17:00'] },
  },
  {
    id: 'D113',
    agency: 'CAM',
    short: 'D113',
    long: 'Funchal – Caniço – Santa Cruz – Aeroporto – Machico – Caniçal',
    ...CAM,
    stops: [
      ['FNC_AVMAR', 0],
      ['SCR_GARAJAU', 18],
      ['SCR_CANICO', 24],
      ['SCR_CENTRO', 38],
      ['SCR_AERO', 44],
      ['MCH_CENTRO', 55],
      ['MCH_CANICAL', 68],
    ],
    weekday: { every: ['06:30', '21:30', 30] },
    saturday: { every: ['07:00', '21:00', 60] },
    sunday: { every: ['07:30', '20:30', 60] },
  },
  {
    id: 'D114',
    agency: 'CAM',
    short: 'D114',
    long: "Machico – Caniçal – Baía d'Abra",
    ...CAM,
    stops: [
      ['MCH_CENTRO', 0],
      ['MCH_CANICAL', 12],
      ['MCH_ABRA', 22],
    ],
    weekday: { every: ['08:00', '18:00', 120] },
    saturday: { every: ['09:00', '17:00', 120] },
    sunday: { every: ['09:00', '17:00', 120] },
  },
  {
    id: 'D103',
    agency: 'CAM',
    short: 'D103',
    long: 'Funchal – Camacha – Santo da Serra – Porto da Cruz',
    ...CAM,
    stops: [
      ['FNC_MERC', 0],
      ['SCR_CAMACHA', 30],
      ['SCR_STSERRA', 55],
      ['MCH_PCRUZ', 80],
    ],
    weekday: { every: ['07:00', '19:00', 120] },
    saturday: { at: ['08:00', '12:00', '16:00'] },
    sunday: { at: ['09:00', '17:00'] },
  },
  {
    id: 'D20',
    agency: 'CAM',
    short: 'D20',
    long: 'Machico – Porto da Cruz – Faial – Santana',
    ...CAM,
    stops: [
      ['MCH_CENTRO', 0],
      ['MCH_PCRUZ', 25],
      ['STN_FAIAL', 45],
      ['STN_CENTRO', 60],
    ],
    weekday: { every: ['07:15', '19:15', 180] },
    saturday: { at: ['09:15', '15:15'] },
    sunday: { at: ['10:15', '16:15'] },
  },
  {
    id: 'AERO',
    agency: 'AERO',
    short: 'Aerobus',
    long: 'Aeroporto – Funchal – Lido',
    ...AERO,
    stops: [
      ['SCR_AERO', 0],
      ['FNC_AVMAR', 30],
      ['FNC_INFANTE', 36],
      ['FNC_LIDO', 45],
      ['FNC_FORUM', 50],
    ],
    weekday: { every: ['08:00', '22:00', 60] },
    saturday: { every: ['08:00', '22:00', 60] },
    sunday: { every: ['08:00', '22:00', 60] },
  },
  {
    id: 'D7',
    agency: 'RDO',
    short: 'D7',
    long: 'Funchal – Câmara de Lobos – Ribeira Brava',
    ...RDO,
    stops: [
      ['FNC_AVMAR', 0],
      ['FNC_INFANTE', 5],
      ['CML_CENTRO', 20],
      ['RBR_CENTRO', 45],
    ],
    weekday: { every: ['06:30', '21:30', 30] },
    saturday: { every: ['07:00', '21:00', 60] },
    sunday: { every: ['07:30', '20:30', 60] },
  },
  {
    id: 'D4',
    agency: 'RDO',
    short: 'D4',
    long: 'Funchal – Estreito – Cabo Girão',
    ...RDO,
    stops: [
      ['FNC_AVMAR', 0],
      ['CML_CENTRO', 20],
      ['CML_ESTREITO', 35],
      ['CML_GIRAO', 48],
    ],
    weekday: { every: ['08:00', '18:00', 120] },
    saturday: { at: ['09:00', '13:00', '17:00'] },
    sunday: { at: ['09:00', '13:00', '17:00'] },
  },
  {
    id: 'D80',
    agency: 'RDO',
    short: 'D80',
    long: 'Funchal – Ribeira Brava – Ponta do Sol – Calheta',
    ...RDO,
    stops: [
      ['FNC_AVMAR', 0],
      ['CML_CENTRO', 18],
      ['RBR_CENTRO', 38],
      ['PSO_CENTRO', 48],
      ['PSO_MADALENA', 58],
      ['CLT_CENTRO', 75],
    ],
    weekday: { every: ['07:00', '19:00', 120] },
    saturday: { at: ['08:00', '11:00', '14:00', '17:00'] },
    sunday: { at: ['09:00', '13:00', '17:00'] },
  },
  {
    id: 'D6',
    agency: 'RDO',
    short: 'D6',
    long: 'Funchal – Ribeira Brava – Encumeada – São Vicente',
    ...RDO,
    stops: [
      ['FNC_AVMAR', 0],
      ['CML_CENTRO', 18],
      ['RBR_CENTRO', 40],
      ['RBR_SERRA', 60],
      ['RBR_ENCUM', 75],
      ['SVC_CENTRO', 95],
    ],
    weekday: { at: ['07:35', '13:35', '17:35'] },
    saturday: { at: ['08:35', '16:35'] },
    sunday: { at: ['08:35', '16:35'] },
  },
  {
    id: 'D139',
    agency: 'RDO',
    short: 'D139',
    long: 'Ribeira Brava – São Vicente – Seixal – Porto Moniz',
    ...RDO,
    stops: [
      ['RBR_CENTRO', 0],
      ['RBR_SERRA', 20],
      ['RBR_ENCUM', 35],
      ['SVC_CENTRO', 55],
      ['PMZ_SEIXAL', 75],
      ['PMZ_CENTRO', 95],
    ],
    weekday: { at: ['08:15', '11:15', '14:45', '17:15'] },
    saturday: { at: ['09:15', '15:15'] },
    sunday: { at: ['09:15', '15:15'] },
  },
  {
    id: 'D142',
    agency: 'RDO',
    short: 'D142',
    long: 'Calheta – Prazeres – Paul do Mar',
    ...RDO,
    stops: [
      ['CLT_CENTRO', 0],
      ['CLT_PRAZERES', 20],
      ['CLT_PAUL', 40],
    ],
    weekday: { at: ['08:30', '11:00', '14:00', '17:30'] },
    saturday: { at: ['09:00', '15:00'] },
    sunday: { at: ['09:00', '15:00'] },
  },
];
