import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Sparkline } from '@/components/dashboard/sparkline';

afterEach(cleanup);

describe('Sparkline', () => {
  it('renders an empty marker when given no values', () => {
    const { container } = render(<Sparkline values={[]} />);
    const svg = container.querySelector('svg[data-slot="sparkline"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-empty')).toBe('true');
    expect(container.querySelector('line')).not.toBeNull();
  });

  it('plots a line + area path for non-empty values', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5, 4]} />);
    const paths = container.querySelectorAll('svg[data-slot="sparkline"] path');
    expect(paths.length).toBe(2); // area + line
    const linePath = paths[1]!.getAttribute('d') ?? '';
    expect(linePath.startsWith('M')).toBe(true);
    expect(linePath).toMatch(/L \d+\.\d{2} \d+\.\d{2}/);
  });

  it('handles a single value without crashing', () => {
    const { container } = render(<Sparkline values={[7]} />);
    expect(container.querySelector('svg[data-slot="sparkline"]')).not.toBeNull();
  });

  it('handles all-equal values without producing NaN', () => {
    const { container } = render(<Sparkline values={[3, 3, 3, 3]} />);
    const linePath = container.querySelectorAll('path')[1]!.getAttribute('d')!;
    expect(linePath).not.toContain('NaN');
  });

  it('exposes an aria-label and role=img when provided', () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3]} ariaLabel="trend" />,
    );
    const svg = container.querySelector('svg[data-slot="sparkline"]')!;
    expect(svg.getAttribute('aria-label')).toBe('trend');
    expect(svg.getAttribute('role')).toBe('img');
  });
});
