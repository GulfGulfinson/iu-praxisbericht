import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { planSemester } from '../src/planner.ts';
import type { CalendarData } from '../src/portal-types.ts';

const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11'];
const workDays = weeks.flatMap((m) => [0, 1, 2].map((i) => {
  const d = new Date(`${m}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
}));

const cal: CalendarData = {
  id: '652',
  semester: 'WISE-2026-Q4',
  workDays,
  examDays: [],
  calendarWeekInfo: [{ calendar_week: '41', is_submitted: '1' }],
};

const config = parseConfig({
  seed: 'test',
  workday: { start: '08:30', hours: 8, break: 30 },
  vacationDays: 6,
  sickDays: 2,
  tasks: ['Bearbeitung von Tickets', { name: 'Bugfix', weight: 3, variants: ['Bugfix im Backend', 'Bugfix im Frontend'] }, 'Code Review', 'Dokumentation', 'Deployment', 'Tests schreiben', { name: 'Monthly Meeting', cadence: 'monthly' }, { name: 'Daily Standup', cadence: 'weekly' }],
});

const today = '2027-01-20';
const plan = () => planSemester(cal, config, today);

describe('planSemester', () => {
  it('plans every practice week up to today except submitted ones', () => {
    const p = plan();
    expect(p.map((w) => w.week)).toEqual([42, 43, 44, 45, 46, 47, 48, 51, 52, 53, 1, 2]);
  });

  it('skips weeks whose practice days are not over yet', () => {
    const p = planSemester(cal, config, '2027-01-12');
    expect(p.at(-1)?.week).toBe(1);
  });

  it('is deterministic for the same seed', () => {
    expect(plan()).toEqual(plan());
  });

  it('places exactly the configured absences and never empties a week', () => {
    const p = plan();
    const days = p.flatMap((w) => w.days);
    expect(days.filter((d) => d.reason === 'vacation')).toHaveLength(6);
    expect(days.filter((d) => d.reason === 'sick')).toHaveLength(2);
    for (const w of p) expect(w.days.some((d) => d.workday && d.special === 0)).toBe(true);
    for (const d of days.filter((x) => x.reason === 'vacation' || x.reason === 'sick')) {
      expect(d).toMatchObject({ special: 8, from: '', to: '', minutes: 0 });
    }
  });

  it('marks Bavarian holidays inside practice weeks', () => {
    const jan6 = plan().flatMap((w) => w.days).find((d) => d.date === '2027-01-06');
    expect(jan6).toMatchObject({ special: 1, reason: 'holiday', minutes: 0 });
  });

  it('writes 5 to 7 bullet points with weekly tasks every week and monthly tasks once a month', () => {
    const p = plan();
    for (const w of p) {
      const lines = w.doings.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(5);
      expect(lines.length).toBeLessThanOrEqual(7);
      expect(lines.every((l) => l.startsWith('-'))).toBe(true);
      expect(new Set(lines).size).toBe(lines.length);
      expect(lines).toContain('-Daily Standup');
    }
    const monthly = p.filter((w) => w.doings.includes('Monthly Meeting')).map((w) => w.days.find((d) => d.workday)?.date.slice(0, 7));
    expect(monthly).toEqual([...new Set(monthly)]);
    expect(monthly.length).toBe(4);
  });

  it('varies start times but keeps roughly the configured net hours and break', () => {
    const p = plan();
    const work = p.flatMap((w) => w.days).filter((d) => d.workday && d.special === 0);
    expect(new Set(work.map((d) => `${d.from}-${d.to}`)).size).toBeGreaterThan(3);
    for (const d of work) {
      const [fh, fm] = d.from.split(':').map(Number); const [th, tm] = d.to.split(':').map(Number);
      expect(d.minutes).toBe(th! * 60 + tm! - (fh! * 60 + fm!) - Number(d.break));
      expect(d.break).toBe('30');
      expect(d.minutes).toBeGreaterThanOrEqual(8 * 60 - 15);
      expect(d.minutes).toBeLessThanOrEqual(8 * 60 + 30);
      expect(d.from >= '08:00' && d.from <= '09:00').toBe(true);
    }
    for (const w of p) expect(w.totalMinutes).toBe(w.days.reduce((s, d) => s + d.minutes, 0));
  });

  it('uses fixed absence dates first', () => {
    const fixed = parseConfig({ ...config, vacationDates: ['2026-10-13'], sickDates: ['2026-11-03'] });
    const days = planSemester(cal, fixed, today).flatMap((w) => w.days);
    expect(days.find((d) => d.date === '2026-10-13')?.reason).toBe('vacation');
    expect(days.find((d) => d.date === '2026-11-03')?.reason).toBe('sick');
    expect(days.filter((d) => d.reason === 'vacation')).toHaveLength(6);
  });

  it('applies per-semester overrides', () => {
    const o = parseConfig({ ...config, overrides: { '652': { vacationDays: 0, sickDays: 0 } } });
    expect(planSemester(cal, o, today).flatMap((w) => w.days).some((d) => d.reason === 'vacation' || d.reason === 'sick')).toBe(false);
  });

  it('fails loudly when absences cannot fit', () => {
    const o = parseConfig({ ...config, vacationDays: 100 });
    expect(() => planSemester(cal, o, today)).toThrow(/vacation/i);
  });
});

describe('parseConfig', () => {
  it('rejects a task list that cannot fill five bullet points', () => {
    expect(() => parseConfig({ tasks: ['a', 'b', 'c'] })).toThrow(/at least/i);
  });
});
