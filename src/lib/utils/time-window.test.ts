import { describe, expect, it } from 'vitest';

import { ITALIAN_HOLIDAYS, isItalianHoliday, nextWindowOpen } from './time-window';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the local hour (HH:MM) of a UTC Date in Europe/Rome.
 * Used to assert computed window-open times without hard-coding UTC offsets.
 */
function romeLocalHHMM(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Returns the local day-of-week (0=Sun … 6=Sat) in Europe/Rome.
 */
function romeDayOfWeek(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day ?? 'Mon'] ?? 1;
}

// ─── Tests: ITALIAN_HOLIDAYS ──────────────────────────────────────────────────

describe('ITALIAN_HOLIDAYS', () => {
  it('contains 10 fixed holidays', () => {
    expect(ITALIAN_HOLIDAYS).toHaveLength(10);
  });

  it('includes Christmas (12-25) and New Year (01-01)', () => {
    expect(ITALIAN_HOLIDAYS).toContain('12-25');
    expect(ITALIAN_HOLIDAYS).toContain('01-01');
  });
});

// ─── Tests: isItalianHoliday ──────────────────────────────────────────────────

describe('isItalianHoliday', () => {
  it('returns true for Liberation Day (25 April)', () => {
    const { TZDate } = require('@date-fns/tz');
    const apr25 = new TZDate(new Date('2024-04-25T10:00:00Z'), 'Europe/Rome');
    expect(isItalianHoliday(apr25)).toBe(true);
  });

  it('returns false for a regular weekday', () => {
    const { TZDate } = require('@date-fns/tz');
    const jan10 = new TZDate(new Date('2024-01-10T10:00:00Z'), 'Europe/Rome');
    expect(isItalianHoliday(jan10)).toBe(false);
  });
});

// ─── Tests: nextWindowOpen — basic window logic ───────────────────────────────

describe('nextWindowOpen — basic window logic', () => {
  it('returns null when inside the window on a weekday', () => {
    // Wednesday 2025-01-15: 09:00 UTC = 10:00 Rome (CET +1) — inside 09:00–19:00
    const wed1000Rome = new Date('2025-01-15T09:00:00Z');
    expect(nextWindowOpen(wed1000Rome, '09:00', '19:00', 'Europe/Rome')).toBeNull();
  });

  it('returns null at exactly window-open time', () => {
    // Wednesday 2025-01-15: 08:00 UTC = 09:00 Rome — exactly at window start
    const wed0900Rome = new Date('2025-01-15T08:00:00Z');
    expect(nextWindowOpen(wed0900Rome, '09:00', '19:00', 'Europe/Rome')).toBeNull();
  });

  it('returns a date when at exactly window-close time', () => {
    // Wednesday 2025-01-15: 18:00 UTC = 19:00 Rome — exactly at window end (exclusive)
    const wed1900Rome = new Date('2025-01-15T18:00:00Z');
    const result = nextWindowOpen(wed1900Rome, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
  });

  it('window-open time is the correct local hour', () => {
    // Wednesday 08:00 UTC = 09:00 Rome (before window)
    const wed0800Rome = new Date('2025-01-15T07:30:00Z'); // 08:30 Rome — before 09:00
    const result = nextWindowOpen(wed0800Rome, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });
});

// ─── Tests: nextWindowOpen — midnight rollover ────────────────────────────────

describe('nextWindowOpen — midnight rollover', () => {
  it('returns today at 09:00 when called at midnight on a weekday', () => {
    // Monday 2025-01-13: 23:00 UTC = 00:00 Rome Tuesday (CET +1)
    const midnightRomeTuesday = new Date('2025-01-13T23:00:00Z');
    const result = nextWindowOpen(midnightRomeTuesday, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Result should be Tuesday 09:00 Rome
    expect(romeLocalHHMM(result!)).toBe('09:00');
    expect(romeDayOfWeek(result!)).toBe(2); // Tuesday
  });

  it('returns today at 09:00 when called at 00:01 on a weekday', () => {
    // Wednesday 2025-01-15: 23:01 UTC previous day = 00:01 Rome (CET +1)
    const justAfterMidnight = new Date('2025-01-14T23:01:00Z');
    const result = nextWindowOpen(justAfterMidnight, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });
});

// ─── Tests: nextWindowOpen — weekends ────────────────────────────────────────

describe('nextWindowOpen — weekends', () => {
  it('skips Saturday and returns Monday at 09:00', () => {
    // Saturday 2025-01-18: 10:00 Rome (09:00 UTC CET +1) — inside window hours but weekend
    const saturdayMorning = new Date('2025-01-18T09:00:00Z');
    const result = nextWindowOpen(saturdayMorning, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeDayOfWeek(result!)).toBe(1); // Monday
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });

  it('skips Sunday and returns Monday at 09:00', () => {
    // Sunday 2025-01-19: 12:00 Rome (11:00 UTC CET +1)
    const sunday = new Date('2025-01-19T11:00:00Z');
    const result = nextWindowOpen(sunday, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeDayOfWeek(result!)).toBe(1); // Monday
  });

  it('returns Monday when called on Friday after-hours', () => {
    // Friday 2025-01-17: 20:00 Rome (19:00 UTC CET +1) — after window end
    const fridayEvening = new Date('2025-01-17T19:00:00Z');
    const result = nextWindowOpen(fridayEvening, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeDayOfWeek(result!)).toBe(1); // Monday
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });

  it('allows weekends when allowWeekends=true', () => {
    // Saturday 10:00 Rome — normally blocked
    const saturdayMorning = new Date('2025-01-18T09:00:00Z');
    const result = nextWindowOpen(saturdayMorning, '09:00', '19:00', 'Europe/Rome', {
      allowWeekends: true,
    });
    // Should be inside the window (Saturday 10:00 is inside 09:00–19:00)
    expect(result).toBeNull();
  });
});

// ─── Tests: nextWindowOpen — Italian public holidays ─────────────────────────

describe('nextWindowOpen — Italian public holidays', () => {
  it('skips Liberation Day (Apr 25, Thursday) and returns Friday Apr 26', () => {
    // 2024-04-25 is a Thursday. Holiday during window hours.
    // 10:00 Rome = 08:00 UTC (CEST +2)
    const liberationDay = new Date('2024-04-25T08:00:00Z');
    const result = nextWindowOpen(liberationDay, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Friday April 26 09:00 Rome (CEST +2) = 07:00 UTC
    expect(result!.toISOString()).toBe('2024-04-26T07:00:00.000Z');
  });

  it('skips consecutive Christmas holidays (Dec 25 and Dec 26) and returns Dec 27', () => {
    // 2024-12-24 Tuesday 20:00 Rome (CET +1) = 19:00 UTC — after window close
    // Dec 25 = Natale, Dec 26 = Santo Stefano; Dec 27 is Friday
    const christmasEveEvening = new Date('2024-12-24T19:00:00Z');
    const result = nextWindowOpen(christmasEveEvening, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Dec 27 09:00 Rome (CET +1) = 08:00 UTC
    expect(result!.toISOString()).toBe('2024-12-27T08:00:00.000Z');
  });

  it('skips a holiday that falls on a weekend (stacked restriction)', () => {
    // Jan 1 2023 falls on a Sunday. Should skip to Mon Jan 2.
    // Dec 31 2022 (Saturday) at 20:00 Rome = 19:00 UTC (CET +1)
    const newYearsEve = new Date('2022-12-31T19:00:00Z');
    const result = nextWindowOpen(newYearsEve, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Jan 1 = Sunday + holiday → skip; Jan 2 = Monday → valid
    // Jan 2 09:00 Rome (CET +1) = 08:00 UTC
    expect(result!.toISOString()).toBe('2023-01-02T08:00:00.000Z');
  });

  it('does NOT skip holidays when skipHolidays=false', () => {
    // Liberation Day 2024 (Thursday): 10:00 Rome is inside window
    const liberationDay = new Date('2024-04-25T08:00:00Z');
    const result = nextWindowOpen(liberationDay, '09:00', '19:00', 'Europe/Rome', {
      skipHolidays: false,
    });
    // Inside window on a Thursday with holidays disabled → null
    expect(result).toBeNull();
  });

  it('skips Ferragosto (Aug 15) and returns the next weekday', () => {
    // 2024-08-15 is a Thursday. 10:00 Rome = 08:00 UTC (CEST +2)
    const ferragosto = new Date('2024-08-15T08:00:00Z');
    const result = nextWindowOpen(ferragosto, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Friday Aug 16 09:00 Rome (CEST +2) = 07:00 UTC
    expect(result!.toISOString()).toBe('2024-08-16T07:00:00.000Z');
  });
});

// ─── Tests: nextWindowOpen — DST transitions ─────────────────────────────────

describe('nextWindowOpen — DST transitions (Europe/Rome)', () => {
  /**
   * Spring forward 2024: last Sunday of March = March 31.
   * Clocks move from 01:59 CET (UTC+1) to 03:00 CEST (UTC+2) — skipping 02:xx.
   *
   * When we land on Monday April 1, it is already in CEST (UTC+2).
   * April 1 09:00 Rome CEST = April 1 07:00 UTC.
   */
  it('handles spring-forward: Friday Mar 29 after hours → Monday Apr 1 09:00 CEST', () => {
    // Friday 2024-03-29 19:30 Rome (CET +1) = 18:30 UTC — after window close
    const fridayBeforeDst = new Date('2024-03-29T18:30:00Z');
    const result = nextWindowOpen(fridayBeforeDst, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Monday Apr 1 09:00 Rome CEST (UTC+2) = 07:00 UTC
    expect(result!.toISOString()).toBe('2024-04-01T07:00:00.000Z');
    expect(romeDayOfWeek(result!)).toBe(1); // Monday
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });

  /**
   * Fall back 2024: last Sunday of October = October 27.
   * Clocks move from 02:59 CEST (UTC+2) back to 02:00 CET (UTC+1).
   *
   * When we land on Monday October 28, it is already in CET (UTC+1).
   * October 28 09:00 Rome CET = October 28 08:00 UTC.
   */
  it('handles fall-back: Friday Oct 25 after hours → Monday Oct 28 09:00 CET', () => {
    // Friday 2024-10-25 19:30 Rome (CEST +2) = 17:30 UTC — after window close
    const fridayBeforeDst = new Date('2024-10-25T17:30:00Z');
    const result = nextWindowOpen(fridayBeforeDst, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Monday Oct 28 09:00 Rome CET (UTC+1) = 08:00 UTC
    expect(result!.toISOString()).toBe('2024-10-28T08:00:00.000Z');
    expect(romeDayOfWeek(result!)).toBe(1); // Monday
    expect(romeLocalHHMM(result!)).toBe('09:00');
  });

  it('handles spring-forward boundary: before window on the transition day', () => {
    // Saturday 2024-03-30: 07:00 Rome (CET +1) = 06:00 UTC — Saturday, before window
    // Should skip to Monday April 1 (passing over DST boundary on March 31)
    const satBeforeDst = new Date('2024-03-30T06:00:00Z');
    const result = nextWindowOpen(satBeforeDst, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Monday Apr 1 09:00 CEST (UTC+2) = 07:00 UTC
    expect(result!.toISOString()).toBe('2024-04-01T07:00:00.000Z');
  });
});

// ─── Tests: nextWindowOpen — custom window times ──────────────────────────────

describe('nextWindowOpen — custom window times', () => {
  it('respects custom window start and end times', () => {
    // Monday 2025-01-13 11:00 Rome = 10:00 UTC — inside custom 10:00–20:00
    const mon11Rome = new Date('2025-01-13T10:00:00Z');
    expect(
      nextWindowOpen(mon11Rome, '10:00', '20:00', 'Europe/Rome'),
    ).toBeNull();
  });

  it('returns next window when outside custom window hours', () => {
    // Monday 2025-01-13 09:30 Rome = 08:30 UTC — before custom 10:00 start
    const mon0930Rome = new Date('2025-01-13T08:30:00Z');
    const result = nextWindowOpen(mon0930Rome, '10:00', '20:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(romeLocalHHMM(result!)).toBe('10:00');
  });
});
