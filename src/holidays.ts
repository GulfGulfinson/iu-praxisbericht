import { addDays } from './dates.ts';

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
const easterSunday = (year: number): string => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** Public holidays in Bavaria, including Mariä Himmelfahrt (Catholic municipalities, e.g. Kirchheim b. München). */
export const bavarianHolidays = (year: number): Set<string> => {
  const easter = easterSunday(year);
  const fixed = ['01-01', '01-06', '05-01', '08-15', '10-03', '11-01', '12-25', '12-26'].map((md) => `${year}-${md}`);
  const movable = [-2, 1, 39, 50, 60].map((offset) => addDays(easter, offset));
  return new Set([...fixed, ...movable]);
};
