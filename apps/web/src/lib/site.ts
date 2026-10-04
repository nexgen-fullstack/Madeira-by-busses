/** The public website. Printed timetables link to their line on it. */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL || 'https://nexgen-fullstack.github.io/madeirabus/';

/** A link that finds a line by its number, which outlives timetable updates. */
export const lineUrl = (number: string) => `${SITE_URL}#/lines?q=${encodeURIComponent(number)}`;
