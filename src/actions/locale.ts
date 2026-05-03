'use server';

import { cookies } from 'next/headers';

export type Locale = 'it' | 'en';

export async function setLocale(locale: Locale) {
  const cookieStore = await cookies();
  cookieStore.set('locale', locale, {
    httpOnly: false, // readable by client JS for i18n hydration
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  });
}
