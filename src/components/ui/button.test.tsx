import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders with default variant', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('renders as disabled when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const)(
    'renders variant %s without errors',
    (variant) => {
      const { container, unmount } = render(
        <Button variant={variant}>{variant}</Button>,
      );
      expect(container.querySelector('button')).not.toBeNull();
      unmount();
    },
  );
});
