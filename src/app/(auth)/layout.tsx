import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      {children}
    </div>
  );
}
