import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { RecordingPlayer } from '@/components/calls/recording-player';
import type { TranscriptSegment } from '@/lib/voice/types';

// jsdom doesn't implement HTMLMediaElement.play/pause; provide minimal stubs
// that toggle `paused` and dispatch the corresponding events so the component
// state stays in sync.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: function play(this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: function pause(this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get() {
      return 60;
    },
  });
});

afterEach(cleanup);

const segments: TranscriptSegment[] = [
  { speaker: 'agent', text: 'Buongiorno, sono Anna.', startMs: 0, endMs: 2_000 },
  { speaker: 'caller', text: 'Salve, mi dica.', startMs: 2_000, endMs: 4_000 },
  { speaker: 'agent', text: 'La chiamo per un appuntamento.', startMs: 4_000, endMs: 7_000 },
];

function renderPlayer(props: Partial<Parameters<typeof RecordingPlayer>[0]> = {}) {
  return render(
    <RecordingPlayer
      audioUrl="https://example.test/recording.mp3"
      transcript={segments}
      {...props}
    />,
  );
}

describe('RecordingPlayer', () => {
  it('renders all transcript segments', () => {
    renderPlayer();
    expect(screen.getByText('Buongiorno, sono Anna.')).toBeInTheDocument();
    expect(screen.getByText('Salve, mi dica.')).toBeInTheDocument();
    expect(screen.getByText('La chiamo per un appuntamento.')).toBeInTheDocument();
  });

  it('shows the empty state when transcript is empty', () => {
    renderPlayer({ transcript: [] });
    expect(screen.getByText('Trascrizione non disponibile')).toBeInTheDocument();
  });

  it('renders the play button initially (audio is paused)', () => {
    renderPlayer();
    expect(screen.getByRole('button', { name: 'Riproduci' })).toBeInTheDocument();
  });

  it('toggles to pause label after clicking play', () => {
    renderPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Riproduci' }));
    expect(screen.getByRole('button', { name: 'Pausa' })).toBeInTheDocument();
  });

  it('clicking a transcript segment seeks the audio to that segment start', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.click(screen.getByText('La chiamo per un appuntamento.'));
    expect(audio.currentTime).toBeCloseTo(4); // 4000ms / 1000
  });

  it('skip-forward button advances currentTime by 15 seconds', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 5;
    fireEvent.click(screen.getByRole('button', { name: 'Avanti di 15 secondi' }));
    expect(audio.currentTime).toBeCloseTo(20);
  });

  it('skip-back button rewinds currentTime by 15 seconds (clamped at 0)', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 5;
    fireEvent.click(screen.getByRole('button', { name: 'Indietro di 15 secondi' }));
    expect(audio.currentTime).toBe(0);
  });

  it('changes playback rate when a speed button is clicked', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.click(screen.getByRole('button', { name: '1.5x', pressed: false }));
    expect(audio.playbackRate).toBe(1.5);
    expect(screen.getByRole('button', { name: '1.5x', pressed: true })).toBeInTheDocument();
  });

  it('renders all four playback rate options', () => {
    renderPlayer();
    expect(screen.getByRole('button', { name: /^0\.5x$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1x$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1\.5x$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2x$/ })).toBeInTheDocument();
  });

  it('marks the segment containing currentTime as current', () => {
    renderPlayer();
    const segmentEl = screen.getByText('Salve, mi dica.').closest('li');
    expect(segmentEl).not.toBeNull();
    // simulate the audio reporting time within segment 2 (2000-4000ms → 2.5s)
    fireEvent.timeUpdate(document.querySelector('audio')!, { target: { currentTime: 2.5 } });
    // After the timeUpdate, the second segment should be current.
    const updatedSegmentEl = screen.getByText('Salve, mi dica.').closest('li');
    expect(updatedSegmentEl?.getAttribute('data-current')).toBe('true');
  });

  it('space key toggles play/pause', () => {
    renderPlayer();
    expect(screen.getByRole('button', { name: 'Riproduci' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pausa' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Riproduci' })).toBeInTheDocument();
  });

  it('J key skips back 15s; L key skips forward 15s', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 30;
    fireEvent.keyDown(window, { key: 'j' });
    expect(audio.currentTime).toBeCloseTo(15);
    fireEvent.keyDown(window, { key: 'l' });
    expect(audio.currentTime).toBeCloseTo(30);
  });

  it('K key toggles play/pause', () => {
    renderPlayer();
    expect(screen.getByRole('button', { name: 'Riproduci' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByRole('button', { name: 'Pausa' })).toBeInTheDocument();
  });

  it('does not hijack space/J/K/L while focus is in an input', () => {
    renderPlayer();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: ' ' });
    // play state must not have flipped
    expect(screen.getByRole('button', { name: 'Riproduci' })).toBeInTheDocument();
    document.body.removeChild(input);
  });

  it('renders speaker labels (agente / interlocutore)', () => {
    renderPlayer();
    expect(screen.getAllByText('Agente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Interlocutore').length).toBeGreaterThan(0);
  });

  it('audio starts with preload="none" and promotes to "metadata" on first interaction', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('preload')).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Riproduci' }));
    expect(audio.getAttribute('preload')).toBe('metadata');
  });

  it('paginates very long transcripts and shows a "more segments" button', () => {
    const longTranscript: TranscriptSegment[] = Array.from({ length: 150 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'agent' : 'caller',
      text: `Segmento numero ${i}`,
      startMs: i * 1_000,
      endMs: (i + 1) * 1_000,
    }));
    const { container } = renderPlayer({ transcript: longTranscript });

    // Only the first 100 segments are rendered initially.
    expect(screen.getByText('Segmento numero 0')).toBeInTheDocument();
    expect(screen.getByText('Segmento numero 99')).toBeInTheDocument();
    expect(screen.queryByText('Segmento numero 100')).not.toBeInTheDocument();

    const list = container.querySelector('ol[data-paginated="true"]');
    expect(list).not.toBeNull();

    // The "show full" button advertises the remaining count and expands on click.
    const showAllButton = screen.getByRole('button', {
      name: 'Mostra altri 50 segmenti',
    });
    fireEvent.click(showAllButton);
    expect(screen.getByText('Segmento numero 100')).toBeInTheDocument();
    expect(screen.getByText('Segmento numero 149')).toBeInTheDocument();
  });

  it('auto-expands the transcript when playback crosses the initial page', () => {
    const longTranscript: TranscriptSegment[] = Array.from({ length: 150 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'agent' : 'caller',
      text: `Auto segmento ${i}`,
      startMs: i * 1_000,
      endMs: (i + 1) * 1_000,
    }));
    const { container } = renderPlayer({ transcript: longTranscript });

    expect(screen.queryByText('Auto segmento 120')).not.toBeInTheDocument();

    // Simulate the audio reporting a position inside segment 120 (≈120s).
    fireEvent.timeUpdate(document.querySelector('audio')!, {
      target: { currentTime: 120.5 },
    });

    // After auto-expansion, segments past the initial page render and the
    // "show full" button is gone.
    expect(screen.getByText('Auto segmento 120')).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="transcript-show-full"]'),
    ).toBeNull();
  });

  it('does not paginate transcripts at or below the threshold', () => {
    const exactlyAtThreshold: TranscriptSegment[] = Array.from(
      { length: 100 },
      (_, i) => ({
        speaker: 'agent' as const,
        text: `At threshold ${i}`,
        startMs: i * 1_000,
        endMs: (i + 1) * 1_000,
      }),
    );
    const { container } = renderPlayer({ transcript: exactlyAtThreshold });
    expect(container.querySelector('ol[data-paginated="true"]')).toBeNull();
    expect(
      container.querySelector('[data-slot="transcript-show-full"]'),
    ).toBeNull();
  });
});
