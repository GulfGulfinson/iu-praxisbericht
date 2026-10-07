import { describe, expect, it } from 'vitest';
import { bavarianHolidays } from '../src/holidays.ts';

describe('bavarianHolidays', () => {
  it('includes fixed and Easter-based holidays for 2027', () => {
    const h = bavarianHolidays(2027);
    for (const d of ['2027-01-01', '2027-01-06', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-05-27', '2027-08-15', '2027-10-03', '2027-11-01', '2027-12-25', '2027-12-26']) {
      expect(h.has(d), d).toBe(true);
    }
    expect(h.size).toBe(13);
  });

  it('computes Easter correctly for 2025', () => {
    const h = bavarianHolidays(2025);
    expect(h.has('2025-04-18')).toBe(true);
    expect(h.has('2025-04-21')).toBe(true);
  });
});
