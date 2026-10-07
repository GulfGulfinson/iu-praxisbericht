import { absencesFor, type Config } from './config.ts';
import { addDays, isoWeek, mondayOf } from './dates.ts';
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

// Start drifts by up to half an hour; the end follows so the net hours stay as planned.
const START_JITTER = [-30, -15, 0, 0, 0, 0, 15, 15, 30];
// Minutes moved from one part-time day to another, so 20h is not always 6:40 x 3.
const SHIFT = [0, 5, 10, 15, 20];
// The portal's calendars only know Mon-Wed weeks and Mon-Fri weeks (plus partial weeks at
// semester edges and holidays); four or more practice days means a full-time week.
const FULL_TIME_MIN_DAYS = 4;
const PART_TIME_DAYS = 3;

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

type Absence = 'vacation' | 'sick';

interface AbsenceState {
  days: string[];
  absent: Map<string, Absence>;
  workLeft: Map<string, number>;
}

// Never takes the last working day of a week: a report with zero work days has nothing to describe.
const takeDay = (state: AbsenceState, day: string, label: Absence): boolean => {
  const monday = mondayOf(day);
  if (state.absent.has(day) || (state.workLeft.get(monday) ?? 0) <= 1) return false;
  state.absent.set(day, label);
  state.workLeft.set(monday, (state.workLeft.get(monday) ?? 0) - 1);
  return true;
};

/** Places configured absence dates; returns how many count towards `count`. */
const placeFixed = (state: AbsenceState, label: Absence, count: number, fixed: string[]): number => {
  let placed = 0;
  for (const day of fixed) if (placed < count && state.days.includes(day) && takeDay(state, day, label)) placed++;
  return placed;
};

/** Fills up to `count` with random runs of consecutive practice days. */
const placeRandom = (rng: Rng, state: AbsenceState, label: Absence, count: number, placed: number, blockLen: [number, number]): void => {
  for (let attempt = 0; placed < count && attempt < 5000; attempt++) {
    const len = Math.min(randInt(rng, blockLen[0], blockLen[1]), count - placed);
    const start = randInt(rng, 0, Math.max(0, state.days.length - len));
    const block = state.days.slice(start, start + len);
    const perWeek = new Map<string, number>();
    for (const d of block) perWeek.set(mondayOf(d), (perWeek.get(mondayOf(d)) ?? 0) + 1);
    const fits = block.every((d) => !state.absent.has(d)) && [...perWeek].every(([m, n]) => (state.workLeft.get(m) ?? 0) - n >= 1);
    if (fits) for (const d of block) if (takeDay(state, d, label)) placed++;
  }
  if (placed < count) throw new Error(`Could only place ${placed} of ${count} ${label} days: not enough practice days left in the open weeks`);
};

const workingDay = (rng: Rng, date: string, config: Config, net: number): DayPlan => {
  const { start, break: configuredBreak } = config.workday;
  // German law: at least 45 min break above 9 h of work.
  const brk = net > 9 * 60 ? Math.max(configuredBreak, 45) : configuredBreak;
  const from = toMinutes(start) + pick(rng, START_JITTER);
  const to = from + net + brk;
  return { date, workday: true, special: SPECIAL.none, from: fromMinutes(from), to: fromMinutes(to), break: String(brk), minutes: net };
};

/** Net minutes for each of the `count` working days in a week. */
const dailyMinutes = (rng: Rng, config: Config, practiceDays: number, count: number): number[] => {
  if (practiceDays >= FULL_TIME_MIN_DAYS) return Array.from({ length: count }, () => Math.round(config.workday.fullTimeDayHours * 60));
  const weekly = Math.round(config.workday.partTimeWeekHours * 60);
  const base = Math.floor(weekly / PART_TIME_DAYS);
  const minutes = Array.from({ length: count }, (_, i) => base + (i < weekly % PART_TIME_DAYS ? 1 : 0));
  if (count >= 2) {
    const [a, b] = shuffle(rng, minutes.map((_, i) => i));
    const shift = pick(rng, SHIFT);
    minutes[a as number] = (minutes[a as number] ?? base) + shift;
    minutes[b as number] = (minutes[b as number] ?? base) - shift;
  }
  return minutes;
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
  const state: AbsenceState = { days: absenceDays, absent: new Map(), workLeft };
  const { vacationDays, sickDays } = absencesFor(config, cal.id);
  // All pinned dates first, so a random vacation block can never take a pinned sick day.
  const fixedVacation = placeFixed(state, 'vacation', vacationDays, config.vacationDates);
  const fixedSick = placeFixed(state, 'sick', sickDays, config.sickDates);
  placeRandom(rng, state, 'vacation', vacationDays, fixedVacation, [1, 5]);
  placeRandom(rng, state, 'sick', sickDays, fixedSick, [1, 2]);
  const absent = state.absent;

  const monthsWithMeeting = new Set<string>();
  let previous = '';
  return weeks.map((w) => {
    const practice = new Set(w.practiceDays);
    const kind = (date: string): 'off' | 'holiday' | 'vacation' | 'sick' | 'work' =>
      !practice.has(date) ? 'off' : holidays.has(date) ? 'holiday' : (absent.get(date) ?? 'work');
    const dates = Array.from({ length: 7 }, (_, i) => addDays(w.monday, i));
    const minutes = dailyMinutes(rng, config, w.practiceDays.length, dates.filter((d) => kind(d) === 'work').length);
    const days = dates.map((date): DayPlan => {
      const k = kind(date);
      if (k === 'off') return { date, workday: false, special: SPECIAL.none, from: '', to: '', break: '', minutes: 0 };
      if (k !== 'work') return offDay(date, k);
      return workingDay(rng, date, config, minutes.shift() ?? 0);
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
