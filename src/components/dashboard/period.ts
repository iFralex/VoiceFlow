import type { DashboardPeriod } from './period-selector';

export type PeriodRange = {
  period: DashboardPeriod;
  start: Date;
  end: Date;
};

export function parsePeriod(raw: string | string[] | undefined): DashboardPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  switch (v) {
    case 'today':
    case '7d':
    case '30d':
    case 'month':
    case 'prev_month':
      return v;
    default:
      return '7d';
  }
}

export function resolvePeriodRange(
  period: DashboardPeriod,
  now: Date = new Date(),
): PeriodRange {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case 'today':
      break;
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case 'month':
      start.setDate(1);
      break;
    case 'prev_month': {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const firstOfPrev = new Date(
        firstOfThisMonth.getFullYear(),
        firstOfThisMonth.getMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      );
      const lastOfPrev = new Date(firstOfThisMonth.getTime() - 1);
      return { period, start: firstOfPrev, end: lastOfPrev };
    }
  }
  return { period, start, end };
}
