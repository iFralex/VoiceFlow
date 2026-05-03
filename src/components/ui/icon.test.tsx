import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icons } from './icon';

describe('Icons', () => {
  it('renders Search icon with default size and strokeWidth', () => {
    const { container } = render(<Icons.Search />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('stroke-width')).toBe('1.5');
  });

  it('allows overriding size', () => {
    const { container } = render(<Icons.Search size={24} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
  });

  it('allows overriding strokeWidth', () => {
    const { container } = render(<Icons.Search strokeWidth={2} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
  });

  it('renders all navigation icons without errors', () => {
    const navIcons = [
      Icons.LayoutDashboard,
      Icons.Megaphone,
      Icons.Users,
      Icons.FileText,
      Icons.CreditCard,
      Icons.Settings,
    ] as const;

    for (const Icon of navIcons) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('renders all status icons without errors', () => {
    const statusIcons = [
      Icons.CheckCircle2,
      Icons.AlertCircle,
      Icons.AlertTriangle,
      Icons.Info,
      Icons.Clock,
      Icons.Loader2,
    ] as const;

    for (const Icon of statusIcons) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('accepts className prop', () => {
    const { container } = render(<Icons.Bell className="text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('text-red-500')).toBe(true);
  });
});
