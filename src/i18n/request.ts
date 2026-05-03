import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get('locale')?.value;
  const locale: 'it' | 'en' = raw === 'en' ? 'en' : 'it';

  const messages = (await import(`./locales/${locale}.json`)).default as Record<
    string,
    Record<string, string>
  >;

  return { locale, messages };
});
