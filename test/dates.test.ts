import { describe, expect, it } from 'vitest';
import { addDays, isoWeek, mondayOf, weekdayIndex } from '../src/dates.ts';

describe('dates', () => {
  it('computes ISO weeks across year boundaries', () => {
    expect(isoWeek('2026-10-05')).toEqual({ year: 2026, week: 41 });
    expect(isoWeek('2026-12-31')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2027-01-03')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2027-01-04')).toEqual({ year: 2027, week: 1 });
    expect(isoWeek('2024-09-30')).toEqual({ year: 2024, week: 40 });
  });

  it('finds the Monday and weekday index', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});
