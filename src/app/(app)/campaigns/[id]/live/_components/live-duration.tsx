'use client';

import * as React from 'react';

/**
 * Renders mm:ss elapsed since `startedAtIso`, ticking every second.
 * Renders "—" when `startedAtIso` is null.
 */
export function LiveDuration({ startedAtIso }: { startedAtIso: string | null }) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!startedAtIso) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtIso]);

  if (!startedAtIso) {
    return <span className="tabular-nums text-muted-foreground">—</span>;
  }
  const startMs = new Date(startedAtIso).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const mm = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const ss = (elapsedSec % 60).toString().padStart(2, '0');
  return <span className="tabular-nums">{`${mm}:${ss}`}</span>;
}
