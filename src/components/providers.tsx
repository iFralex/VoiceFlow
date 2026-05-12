'use client';

import { ThemeProvider } from 'next-themes';
import * as React from 'react';

import { PostHogProvider } from './posthog-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        {children}
      </ThemeProvider>
    </PostHogProvider>
  );
}
