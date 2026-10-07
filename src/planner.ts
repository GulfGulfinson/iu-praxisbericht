import { absencesFor, type Config } from './config.ts';
import { addDays, isoWeek, mondayOf, weekdayIndex } from './dates.ts';
import { bavarianHolidays } from './holidays.ts';
import { calendarSchema, type CalendarData } from './portal-types.ts';
import { createRng, pick, randInt, type Rng, shuffle, weightedSample } from './rng.ts';

/** Portal codes for the per-day "Sondertag" select. */
export const SPECIAL = { none: 0, holiday: 1, absence: 8 } as const;

export interface DayPlan {
  date: string;
  /** Whether the day row is ticked as a practice day in the report. */
  workday: boolean;
  special: number;
  from: string;
  to: string;
  break: string;
  minutes: number;
  reason?: 'vacation' | 'sick' | 'holiday';
}

export interface WeekPlan {
  semesterId: string;
  week: number;
  monday: string;
  days: DayPlan[];
  doings: string;
  happiness: number;
  totalMinutes: number;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMinutes = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Most days start and end on the template time; occasional quarter-hour drift looks like a real log.
const JITTER = [-30, -15, 0, 0, 0, 0, 15, 15, 30];

interface PracticeWeek {
  monday: string;
  week: number;
  practiceDays: string[];
}

const eligibleWeeks = (cal: CalendarData, today: string): PracticeWeek[] => {
  const submitted = new Set(cal.calendarWeekInfo?.filter((w) => w.is_submitted === '1').map((w) => Number(w.calendar_week)));
  const byMonday = new Map<string, string[]>();
  for (const day of [...cal.workDays].sort()) {
    const monday = mondayOf(day);
    byMonday.set(monday, [...(byMonday.get(monday) ?? []), day]);
  }
  return [...byMonday.entries()]
    .map(([monday, practiceDays]) => ({ monday, week: isoWeek(monday).week, practiceDays }))
    .filter((w) => !submitted.has(w.week) && (w.practiceDays.at(-1) ?? '') <= today);
};

/**
 * Places `count` absence days as runs of consecutive practice days, never taking the last
 * working day of a week: a report with zero work days would have nothing to write about.
 */
const placeAbsences = (
  rng: Rng,
  label: 'vacation' | 'sick',
  count: number,
  fixed: string[],
  days: string[],
  absent: Map<string, 'vacation' | 'sick'>,
  workLeft: Map<string, number>,
  blockLen: [number, number],
): void => {
  const take = (day: string): boolean => {
    const monday = mondayOf(day);
    if (absent.has(day) || (workLeft.get(monday) ?? 0) <= 1) return false;
    absent.set(day, label);
    workLeft.set(monday, (workLeft.get(monday) ?? 0) - 1);
    return true;
  };
  let placed = 0;
  for (const day of fixed) if (placed < count && days.includes(day) && take(day)) placed++;
  for (let attempt = 0; placed < count && attempt < 5000; attempt++) {
    const len = Math.min(randInt(rng, blockLen[0], blockLen[1]), count - placed);
    const start = randInt(rng, 0, Math.max(0, days.length - len));
    const block = days.slice(start, start + len);
    const perWeek = new Map<string, number>();
    for (const d of block) perWeek.set(mondayOf(d), (perWeek.get(mondayOf(d)) ?? 0) + 1);
    const fits = block.every((d) => !absent.has(d)) && [...perWeek].every(([m, n]) => (workLeft.get(m) ?? 0) - n >= 1);
    if (fits) for (const d of block) if (take(d)) placed++;
  }
  if (placed < count) throw new Error(`Could only place ${placed} of ${count} ${label} days: not enough practice days left in the open weeks`);
};

const workingDay = (rng: Rng, date: string, cal: CalendarData, config: Config): DayPlan => {
  const t = cal.template?.days[weekdayIndex(date)];
  const base = t && t.workday === 'true' && t.from && t.to
    ? { from: t.from, to: t.to, break: Number(t.break) || 30 }
    : config.defaultDay;
  const from = toMinutes(base.from) + pick(rng, JITTER);
  const to = toMinutes(base.to) + pick(rng, JITTER);
  const gross = to - from;
  // German law: 30 min break above 6 h, 45 min above 9 h; sometimes people take longer anyway.
  const brk = gross - 30 > 9 * 60 ? 45 : rng() < 0.2 ? 45 : Math.max(base.break, 30);
  return { date, workday: true, special: SPECIAL.none, from: fromMinutes(from), to: fromMinutes(to), break: String(brk), minutes: gross - brk };
};

const offDay = (date: string, reason: DayPlan['reason']): DayPlan => ({
  date,
  workday: true,
  special: reason === 'holiday' ? SPECIAL.holiday : SPECIAL.absence,
  from: '',
  to: '',
  break: '',
  minutes: 0,
  reason,
});

const writeDoings = (rng: Rng, config: Config, includeMonthly: boolean, previous: string): string => {
  const weekly = config.tasks.filter((t) => t.cadence === 'weekly');
  const monthly = includeMonthly ? config.tasks.filter((t) => t.cadence === 'monthly') : [];
  const random = config.tasks.filter((t) => t.cadence === 'random');
  for (let attempt = 0; ; attempt++) {
    const target = randInt(rng, config.tasksPerWeek.min, config.tasksPerWeek.max);
    const fixed = [...weekly, ...monthly].slice(0, target);
    const sampled = weightedSample(rng, random.map((t) => ({ item: t, weight: t.weight })), target - fixed.length);
    const lines = shuffle(rng, [...fixed, ...sampled]).map((t) => `-${pick(rng, t.variants)}`);
    const unique = [...new Set(lines)];
    const doings = unique.join('\n');
    if ((doings !== previous && unique.length >= config.tasksPerWeek.min) || attempt > 20) return doings;
  }
};

export const planSemester = (calendar: CalendarData, config: Config, today: string): WeekPlan[] => {
  const cal = calendarSchema.parse(calendar);
  const rng = createRng(`${config.seed}:${cal.id}`);
  const weeks = eligibleWeeks(cal, today);
  const years = new Set(weeks.flatMap((w) => w.practiceDays.map((d) => Number(d.slice(0, 4)))));
  const holidays = new Set(config.holidays ? [...years].flatMap((y) => [...bavarianHolidays(y)]) : []);

  const absenceDays = weeks.flatMap((w) => w.practiceDays).filter((d) => !holidays.has(d));
  const workLeft = new Map(weeks.map((w) => [w.monday, w.practiceDays.filter((d) => !holidays.has(d)).length]));
  const absent = new Map<string, 'vacation' | 'sick'>();
  const { vacationDays, sickDays } = absencesFor(config, cal.id);
  placeAbsences(rng, 'vacation', vacationDays, config.vacationDates, absenceDays, absent, workLeft, [1, 5]);
  placeAbsences(rng, 'sick', sickDays, config.sickDates, absenceDays, absent, workLeft, [1, 2]);

  const monthsWithMeeting = new Set<string>();
  let previous = '';
  return weeks.map((w) => {
    const practice = new Set(w.practiceDays);
    const days = Array.from({ length: 7 }, (_, i): DayPlan => {
      const date = addDays(w.monday, i);
      if (!practice.has(date)) return { date, workday: false, special: SPECIAL.none, from: '', to: '', break: '', minutes: 0 };
      if (holidays.has(date)) return offDay(date, 'holiday');
      const reason = absent.get(date);
      return reason ? offDay(date, reason) : workingDay(rng, date, cal, config);
    });
    const month = w.practiceDays[0]?.slice(0, 7) ?? '';
    const includeMonthly = !monthsWithMeeting.has(month);
    monthsWithMeeting.add(month);
    const doings = writeDoings(rng, config, includeMonthly, previous);
    previous = doings;
    return {
      semesterId: cal.id,
      week: w.week,
      monday: w.monday,
      days,
      doings,
      happiness: pick(rng, [3, 4, 4, 4, 5, 5]),
      totalMinutes: days.reduce((s, d) => s + d.minutes, 0),
    };
  });
};
