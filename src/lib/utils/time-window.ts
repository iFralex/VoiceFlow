import { TZDate } from '@date-fns/tz';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_TZ = 'Europe/Rome';
export const DEFAULT_WINDOW_START = '09:00';
export const DEFAULT_WINDOW_END = '19:00';

/**
 * Italian fixed public holidays in MM-DD format.
 * Variable holidays (Pasqua, Lunedì dell'Angelo) are excluded as they require
 * a computus algorithm and change year-to-year.
 */
export const ITALIAN_HOLIDAYS: readonly string[] = [
  '01-01', // Capodanno (New Year's Day)
  '01-06', // Epifania (Epiphany)
  '04-25', // Festa della Liberazione (Liberation Day)
  '05-01', // Festa del lavoro (Labour Day)
  '06-02', // Festa della Repubblica (Republic Day)
  '08-15', // Ferragosto (Assumption of Mary)
  '11-01', // Tutti i Santi (All Saints' Day)
  '12-08', // Immacolata Concezione (Immaculate Conception)
  '12-25', // Natale (Christmas Day)
  '12-26', // Santo Stefano (St. Stephen's Day)
];

// ─── Options ──────────────────────────────────────────────────────────────────

export interface WindowOptions {
  /** Allow Saturday and Sunday as call days (default: false). */
  allowWeekends?: boolean;
  /** Skip Italian public holidays (default: true). */
  skipHolidays?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMM(hhmm: string): { h: number; m: number } {
  const parts = hhmm.split(':');
  return {
    h: parseInt(parts[0] ?? '9', 10),
    m: parseInt(parts[1] ?? '0', 10),
  };
}

/**
 * Returns true when the given TZDate falls on a fixed Italian public holiday.
 * Uses the MM-DD representation in local (tz) wall-clock time.
 */
export function isItalianHoliday(tzDate: TZDate): boolean {
  const mm = String(tzDate.getMonth() + 1).padStart(2, '0');
  const dd = String(tzDate.getDate()).padStart(2, '0');
  return (ITALIAN_HOLIDAYS as string[]).includes(`${mm}-${dd}`);
}

/**
 * Returns true when the given TZDate represents a day on which calls may be
 * placed, according to the supplied options.
 */
function isValidCallDay(tzDate: TZDate, allowWeekends: boolean, skipHolidays: boolean): boolean {
  const dow = tzDate.getDay(); // 0 = Sunday, 6 = Saturday
  if (!allowWeekends && (dow === 0 || dow === 6)) return false;
  if (skipHolidays && isItalianHoliday(tzDate)) return false;
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes when the next call-window opens given the current timestamp.
 *
 * Returns `null` when `now` is already inside an open window on a valid call
 * day (dispatch can proceed immediately).
 *
 * Returns a `Date` (UTC) representing the earliest moment a dispatch is
 * permitted when `now` is outside the window or on a restricted day (weekend,
 * public holiday).
 *
 * DST transitions are handled correctly: `TZDate` maps local wall-clock dates
 * to UTC accounting for Europe/Rome's summer (CEST, UTC+2) and winter (CET,
 * UTC+1) offsets, so advancing by one calendar day always produces the right
 * UTC timestamp regardless of whether a DST boundary falls between `now` and
 * the computed result.
 *
 * @param now         - Current timestamp (treated as a UTC instant)
 * @param windowStart - Window open time as "HH:MM" 24-hour (default "09:00")
 * @param windowEnd   - Window close time as "HH:MM" 24-hour (default "19:00")
 * @param tz          - IANA timezone name (default "Europe/Rome")
 * @param options     - Optional overrides for weekends and holiday skipping
 */
export function nextWindowOpen(
  now: Date,
  windowStart: string = DEFAULT_WINDOW_START,
  windowEnd: string = DEFAULT_WINDOW_END,
  tz: string = DEFAULT_TZ,
  options?: WindowOptions,
): Date | null {
  const allowWeekends = options?.allowWeekends ?? false;
  const skipHolidays = options?.skipHolidays ?? true;

  const { h: startH, m: startM } = parseHHMM(windowStart);
  const { h: endH, m: endM } = parseHHMM(windowEnd);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Express `now` in the target timezone.  TZDate's instance methods (.getHours(),
  // .getDay(), .getDate() etc.) return local wall-clock values for `tz`, while
  // .getTime() still returns UTC milliseconds — exactly the semantics we need.
  const local = new TZDate(now, tz);
  const nowMinutes = local.getHours() * 60 + local.getMinutes();
  const isValidToday = isValidCallDay(local, allowWeekends, skipHolidays);
  const insideWindow = isValidToday && nowMinutes >= startMinutes && nowMinutes < endMinutes;

  if (insideWindow) return null;

  // Build a candidate "next window open" time.
  // We operate on a TZDate copy so that setDate()/setHours() advance in local
  // wall-clock time rather than in raw UTC seconds, ensuring DST-safe day
  // arithmetic (a local "tomorrow" is always the next calendar date regardless
  // of whether the UTC day is 23, 24, or 25 hours long due to a DST boundary).
  const candidate = new TZDate(now, tz);
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);

  if (isValidToday && nowMinutes < startMinutes) {
    // Same valid call-day but before the window opens: set to today's start.
    candidate.setHours(startH, startM, 0, 0);
  } else {
    // After window close, or on a restricted day (weekend / holiday):
    // advance to the next calendar day, then skip any further restricted days.
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(startH, startM, 0, 0);
    while (!isValidCallDay(candidate, allowWeekends, skipHolidays)) {
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  // TZDate.getTime() returns UTC milliseconds; wrapping in Date yields the
  // correct UTC instant for the window-open moment in the target timezone.
  return new Date(candidate.getTime());
}
