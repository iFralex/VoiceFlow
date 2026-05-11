'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect } from 'react';

interface PostHogProviderProps {
  children: React.ReactNode;
  posthogKey: string | undefined;
  posthogHost: string | undefined;
}

export function PostHogProvider({ children, posthogKey, posthogHost }: PostHogProviderProps) {
  useEffect(() => {
    if (!posthogKey) return;
    posthog.init(posthogKey, {
      api_host: posthogHost ?? 'https://eu.i.posthog.com',
      // Respect privacy: disable session recording and autocapture
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });
  }, [posthogKey, posthogHost]);

  if (!posthogKey) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
