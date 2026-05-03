'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  } else if (error.digest) {
    console.error('Error digest:', error.digest);
  }
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">Error</h1>
      <p className="mt-4 text-lg text-gray-600">An unexpected error has occurred.</p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-black px-4 py-2 text-white hover:bg-gray-800"
      >
        Try again
      </button>
    </main>
  );
}
