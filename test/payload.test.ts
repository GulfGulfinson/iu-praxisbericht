import { describe, expect, it } from 'vitest';
import { toForm } from '../src/payload.ts';

describe('toForm', () => {
  it('encodes nested objects and arrays like jQuery.param', () => {
    expect(toForm({ week: { weeknumber: 41, doings: '-a\n-b' }, days: [{ date: '2026-10-05', workday: true }, { date: '', workday: false }], submit: false })).toEqual({
      'week[weeknumber]': '41',
      'week[doings]': '-a\n-b',
      'days[0][date]': '2026-10-05',
      'days[0][workday]': 'true',
      'days[1][date]': '',
      'days[1][workday]': 'false',
      submit: 'false',
    });
  });
});
