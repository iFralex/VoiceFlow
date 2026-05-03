import { t } from '@/i18n/server';

export default async function DashboardPage() {
  const translate = await t('nav');
  return (
    <div>
      <h1 className="text-2xl font-semibold">{translate('dashboard')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{translate('dashboard_welcome')}</p>
    </div>
  );
}
