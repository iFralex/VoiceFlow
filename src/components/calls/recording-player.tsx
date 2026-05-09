'use client';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/index';
import type { TranscriptSegment } from '@/lib/voice/types';

const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const SKIP_SECONDS = 15;

// Long-call transcripts (≈10+ minutes at typical pacing) can run into the
// hundreds of segments. Render the first page eagerly and let the user expand
// the rest on demand to keep the initial DOM small. The cutoff is also
// auto-bypassed once playback advances past the visible range.
const TRANSCRIPT_INITIAL_SEGMENTS = 100;

export type RecordingPlayerProps = {
  audioUrl: string;
  transcript: TranscriptSegment[];
  /** Optional duration override (used as a hint while metadata is still loading). */
  durationSeconds?: number;
};

export function RecordingPlayer({
  audioUrl,
  transcript,
  durationSeconds,
}: RecordingPlayerProps) {
  const t = useTranslations('recording_player');
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptListRef = useRef<HTMLOListElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [rate, setRate] = useState<PlaybackRate>(1);
  // Audio is loaded lazily: the <audio> element starts with preload="none" so
  // no bytes are fetched until the user actually interacts. Once the user hits
  // play (or seeks), we promote preload to "metadata" so duration/seeking work.
  const [audioActivated, setAudioActivated] = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const isPaginated = transcript.length > TRANSCRIPT_INITIAL_SEGMENTS;

  // Index of the segment that contains, or most recently started before, currentTime.
  const currentSegmentIdx = useMemo(() => {
    const ms = currentTime * 1000;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      const seg = transcript[i];
      if (seg && seg.startMs <= ms) idx = i;
      else break;
    }
    return idx;
  }, [transcript, currentTime]);

  // Auto-expand the remainder of the transcript once playback crosses the
  // initial page boundary, so the auto-scroll-to-current-segment behaviour
  // keeps working on long calls. Derived from playback state so we don't need
  // to mirror it in `useState` + `useEffect`.
  const effectiveShowFull =
    showFullTranscript || currentSegmentIdx >= TRANSCRIPT_INITIAL_SEGMENTS;
  const visibleTranscript =
    !isPaginated || effectiveShowFull
      ? transcript
      : transcript.slice(0, TRANSCRIPT_INITIAL_SEGMENTS);

  // Apply playback rate to the audio element whenever the user changes it.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // Auto-scroll the active segment into view. When the transcript is paginated
  // and the current segment hasn't been rendered yet, skip the scroll: the
  // auto-expand effect above will expand the list, and a re-render will fire
  // this effect again with the segment now in the DOM.
  useEffect(() => {
    if (currentSegmentIdx < 0) return;
    if (currentSegmentIdx >= visibleTranscript.length) return;
    const list = transcriptListRef.current;
    if (!list) return;
    const segmentEl = list.children[currentSegmentIdx];
    if (segmentEl instanceof HTMLElement) {
      segmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSegmentIdx, visibleTranscript.length]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioActivated(true);
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioActivated(true);
    const max = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.max(0, Math.min(max, audio.currentTime + seconds));
    setCurrentTime(audio.currentTime);
  }, []);

  const seekToMs = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioActivated(true);
    audio.currentTime = ms / 1000;
    setCurrentTime(audio.currentTime);
    if (audio.paused) void audio.play();
  }, []);

  // Global keyboard shortcuts: space, J, K, L.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          skip(-SKIP_SECONDS);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          skip(SKIP_SECONDS);
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, skip]);

  return (
    <div className="grid gap-4 md:grid-cols-2" data-slot="recording-player">
      <div className="flex flex-col gap-3">
        <audio
          ref={audioRef}
          src={audioUrl}
          preload={audioActivated ? 'metadata' : 'none'}
          aria-label={t('audio_label')}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => skip(-SKIP_SECONDS)}
            aria-label={t('skip_back')}
            type="button"
          >
            <SkipBack />
          </Button>
          <Button
            size="icon"
            onClick={togglePlay}
            aria-label={playing ? t('pause') : t('play')}
            type="button"
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => skip(SKIP_SECONDS)}
            aria-label={t('skip_forward')}
            type="button"
          >
            <SkipForward />
          </Button>
          <span
            className="ml-2 text-xs tabular-nums text-muted-foreground"
            data-slot="recording-time"
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div
            className="ml-auto flex gap-1"
            role="group"
            aria-label={t('speed_group_label')}
          >
            {PLAYBACK_RATES.map((r) => (
              <Button
                key={r}
                variant={rate === r ? 'default' : 'outline'}
                size="xs"
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                type="button"
              >
                {r}x
              </Button>
            ))}
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={Math.min(currentTime, duration > 0 ? duration : currentTime)}
          aria-label={t('seek_label')}
          onChange={(e) => {
            const v = parseFloat(e.currentTarget.value);
            const audio = audioRef.current;
            if (audio) audio.currentTime = v;
            setCurrentTime(v);
          }}
          className="w-full"
        />
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <h3 className="text-sm font-medium">{t('transcript')}</h3>
        <ol
          ref={transcriptListRef}
          className="max-h-[400px] overflow-y-auto rounded-lg border p-2"
          aria-label={t('transcript')}
          data-paginated={isPaginated && !effectiveShowFull ? 'true' : undefined}
        >
          {transcript.length === 0 ? (
            <li className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t('transcript_empty')}
            </li>
          ) : (
            <>
              {visibleTranscript.map((seg, idx) => {
                const isCurrent = currentSegmentIdx === idx;
                return (
                  <li
                    key={`${seg.startMs}-${idx}`}
                    data-current={isCurrent ? 'true' : undefined}
                    className={cn(
                      'cursor-pointer rounded px-2 py-1 text-sm transition-colors hover:bg-muted',
                      isCurrent && 'bg-muted font-medium',
                    )}
                    onClick={() => seekToMs(seg.startMs)}
                    role="button"
                    tabIndex={0}
                    aria-current={isCurrent ? 'true' : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        seekToMs(seg.startMs);
                      }
                    }}
                  >
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {seg.speaker === 'agent'
                          ? t('speaker_agent')
                          : t('speaker_caller')}
                      </span>
                      <span className="tabular-nums">
                        {formatTime(seg.startMs / 1000)}
                      </span>
                    </div>
                    <p className="text-foreground">{seg.text}</p>
                  </li>
                );
              })}
              {isPaginated && !effectiveShowFull && (
                <li className="px-2 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    data-slot="transcript-show-full"
                    onClick={() => setShowFullTranscript(true)}
                  >
                    {t('transcript_show_full', {
                      remaining: transcript.length - TRANSCRIPT_INITIAL_SEGMENTS,
                    })}
                  </Button>
                </li>
              )}
            </>
          )}
        </ol>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
