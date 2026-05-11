'use client';

import { useTranslations } from 'next-intl';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(error);
  } else if (error.digest) {
    // eslint-disable-next-line no-console
    console.error('Error digest:', error.digest);
  }
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">{t('title')}</h1>
      <p className="mt-4 text-lg text-gray-600">{t('message')}</p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-black px-4 py-2 text-white hover:bg-gray-800"
      >
        {t('retry')}
      </button>
    </main>
  );
}
