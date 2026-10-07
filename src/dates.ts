// All dates are ISO "YYYY-MM-DD" strings handled in UTC, so local DST never shifts a day.

const parse = (date: string): Date => new Date(`${date}T00:00:00Z`);
const format = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
};

/** 0 = Monday ... 6 = Sunday */
export const weekdayIndex = (date: string): number => (parse(date).getUTCDay() + 6) % 7;

export const mondayOf = (date: string): string => addDays(date, -weekdayIndex(date));

export const isoWeek = (date: string): { year: number; week: number } => {
  const thursday = parse(addDays(date, 3 - weekdayIndex(date)));
  const year = thursday.getUTCFullYear();
  const firstThursday = parse(`${year}-01-01`);
  const dayOfYear = (thursday.getTime() - firstThursday.getTime()) / 86_400_000;
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
};

export const localToday = (): string => {
  const now = new Date();
  return format(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
};
