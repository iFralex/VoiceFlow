import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DetailPageSkeleton,
  KpiCardSkeleton,
  KpiRowSkeleton,
  ListPageSkeleton,
} from '@/components/ui/page-skeleton';

afterEach(cleanup);

describe('KpiCardSkeleton', () => {
  it('renders with the correct data-slot', () => {
    const { container } = render(<KpiCardSkeleton />);
    expect(container.querySelector('[data-slot="kpi-card-skeleton"]')).toBeInTheDocument();
  });

  it('accepts a custom className', () => {
    const { container } = render(<KpiCardSkeleton className="custom" />);
    expect(container.querySelector('[data-slot="kpi-card-skeleton"]')).toHaveClass('custom');
  });

  it('contains three skeleton lines', () => {
    const { container } = render(<KpiCardSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBe(3);
  });
});

describe('KpiRowSkeleton', () => {
  it('renders 4 cards by default', () => {
    const { container } = render(<KpiRowSkeleton />);
    const cards = container.querySelectorAll('[data-slot="kpi-card-skeleton"]');
    expect(cards.length).toBe(4);
  });

  it('renders the requested count of cards', () => {
    const { container } = render(<KpiRowSkeleton count={3} />);
    const cards = container.querySelectorAll('[data-slot="kpi-card-skeleton"]');
    expect(cards.length).toBe(3);
  });

  it('renders with the correct data-slot', () => {
    const { container } = render(<KpiRowSkeleton />);
    expect(container.querySelector('[data-slot="kpi-row-skeleton"]')).toBeInTheDocument();
  });
});

describe('ListPageSkeleton', () => {
  it('renders with the correct data-slot', () => {
    const { container } = render(<ListPageSkeleton />);
    expect(container.querySelector('[data-slot="list-page-skeleton"]')).toBeInTheDocument();
  });

  it('renders 8 rows by default', () => {
    const { container } = render(<ListPageSkeleton />);
    // each row has 4 skeleton spans
    const rows = container.querySelectorAll('[data-slot="list-page-skeleton"] .border-b');
    expect(rows.length).toBe(8);
  });

  it('renders the requested row count', () => {
    const { container } = render(<ListPageSkeleton rowCount={3} />);
    const rows = container.querySelectorAll('[data-slot="list-page-skeleton"] .border-b');
    expect(rows.length).toBe(3);
  });
});

describe('DetailPageSkeleton', () => {
  it('renders with the correct data-slot', () => {
    const { container } = render(<DetailPageSkeleton />);
    expect(container.querySelector('[data-slot="detail-page-skeleton"]')).toBeInTheDocument();
  });

  it('renders multiple skeleton sections', () => {
    const { container } = render(<DetailPageSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    // header (2) + action buttons (2) + body card (3) + sidebar card (1+4*2) = at least 12
    expect(skeletons.length).toBeGreaterThanOrEqual(12);
  });

  it('accepts a custom className', () => {
    const { container } = render(<DetailPageSkeleton className="custom" />);
    expect(container.querySelector('[data-slot="detail-page-skeleton"]')).toHaveClass('custom');
  });
});
