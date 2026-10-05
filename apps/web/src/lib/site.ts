/** The app's name, as on its logo and in the app stores. */
export const APP_NAME = 'Madeira by busses';

/** The name at the start of saved files: Madeira-by-busses-110-Centro.pdf. */
export const FILE_PREFIX = 'Madeira-by-busses';

/** The public website. Printed timetables link to their line on it. */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL || 'https://nexgen-fullstack.github.io/Madeira-by-busses/';

/** A link that finds a line by its number, which outlives timetable updates. */
export const lineUrl = (number: string) => `${SITE_URL}#/lines?q=${encodeURIComponent(number)}`;
