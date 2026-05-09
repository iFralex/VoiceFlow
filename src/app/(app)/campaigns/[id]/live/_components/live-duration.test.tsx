import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveDuration } from './live-duration';

afterEach(cleanup);

describe('LiveDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T10:00:30.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders em-dash when startedAtIso is null', () => {
    render(<LiveDuration startedAtIso={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders mm:ss elapsed since startedAtIso', () => {
    render(<LiveDuration startedAtIso="2026-05-09T10:00:00.000Z" />);
    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('ticks every second', () => {
    render(<LiveDuration startedAtIso="2026-05-09T10:00:00.000Z" />);
    expect(screen.getByText('00:30')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('00:32')).toBeInTheDocument();
  });

  it('formats minutes correctly', () => {
    render(<LiveDuration startedAtIso="2026-05-09T09:58:00.000Z" />);
    expect(screen.getByText('02:30')).toBeInTheDocument();
  });
});
