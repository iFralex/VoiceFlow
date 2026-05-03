import { type NextRequest, NextResponse } from 'next/server';

/**
 * Middleware: resolves the active locale from the `locale` cookie and attaches
 * it as an `x-locale` request header so downstream Server Components can read
 * it synchronously via `headers()` if needed. Falls back to Italian ('it').
 *
 * No URL-based locale routing is used — the locale lives entirely in the cookie
 * written by `src/actions/locale.ts` (`setLocale`).
 */
export function middleware(request: NextRequest): NextResponse {
  const raw = request.cookies.get('locale')?.value;
  const locale = raw === 'en' ? 'en' : 'it';

  const response = NextResponse.next();
  response.headers.set('x-locale', locale);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
