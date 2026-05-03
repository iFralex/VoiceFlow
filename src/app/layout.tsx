import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'VoiceFlow',
  description: 'AI-powered voice outreach platform for sales teams',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="it" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
