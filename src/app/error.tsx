'use client';

export default function Error({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">Errore</h1>
      <p className="mt-4 text-lg text-gray-600">Si è verificato un errore imprevisto.</p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-black px-4 py-2 text-white hover:bg-gray-800"
      >
        Riprova
      </button>
    </main>
  );
}
