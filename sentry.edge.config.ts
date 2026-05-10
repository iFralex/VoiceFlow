import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === 'production' ? 0.1 : 1.0,
  debug: false,
  beforeSend(event) {
    let text = JSON.stringify(event);
    text = text.replace(/\+39[0-9]{6,12}/g, '[redacted-phone]');
    text = text.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      '[redacted-email]',
    );
    return JSON.parse(text) as typeof event;
  },
});
