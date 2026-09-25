import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysBetween,
  isISODate,
  monthGrid,
  nextOccurrence,
  occurrencesBetween,
  today,
} from '../src/lib/dates.ts';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-9-1')).toBe(false);
  });

  it('counts days across DST changes without drift', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-10-31')).toBe(-1);
  });

  it('clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });

  it('returns to the 31st after a short month (no anchor drift)', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(occurrencesBetween('2026-01-31', 'monthly', '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('finds the next occurrence from an old anchor', () => {
    expect(nextOccurrence('2019-06-10', 'weekly', '2026-09-23')).toBe('2026-09-28'); // Mondays
    expect(nextOccurrence('2019-06-12', 'weekly', '2026-09-23')).toBe('2026-09-23');
    expect(nextOccurrence('2020-09-24', 'annual', '2026-09-23')).toBe('2026-09-24');
    expect(nextOccurrence('2026-10-01', 'monthly', '2026-09-23')).toBe('2026-10-01');
    expect(nextOccurrence('2026-01-15', 'quarterly', '2026-09-23')).toBe('2026-10-15');
  });

  it('builds Monday-first month grids', () => {
    const grid = monthGrid('2026-09-23');
    expect(grid[0]![0]).toBe('2026-08-31');
    expect(grid.flat()).toContain('2026-09-30');
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  it('uses the local calendar date for today()', () => {
    expect(today(new Date(2026, 8, 23, 23, 59))).toBe('2026-09-23');
  });
});
