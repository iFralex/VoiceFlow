import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom does not implement ResizeObserver (used by cmdk and other UI libs)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement scrollIntoView (used by cmdk)
Element.prototype.scrollIntoView ??= () => {};

// ---------------------------------------------------------------------------
// Global next-intl mock for unit tests.
//
// Components use useTranslations(namespace) which returns t(key).
// The mock returns the Italian string for each key so all existing tests that
// check for Italian UI text continue to pass without wrapping in
// NextIntlClientProvider.
// ---------------------------------------------------------------------------
const _italianStrings: Record<string, Record<string, string>> = {
  common: {
    open_menu: 'Apri menu',
    search_placeholder: 'Cerca...',
    search_label: 'Apri ricerca (Cmd+K)',
    notifications: 'Notifiche',
    expand_sidebar: 'Espandi barra laterale',
    collapse_sidebar: 'Comprimi barra laterale',
    expand: 'Espandi',
    collapse: 'Comprimi',
    mobile_nav_label: 'Menu di navigazione',
    organizations: 'Organizzazioni',
    create_new_org: 'Crea nuova organizzazione',
    org_switcher_label: 'Cambia organizzazione',
    default_org_name: 'Organizzazione',
    marketing_nav_label: 'Navigazione marketing',
    marketing_sign_in: 'Accedi',
    marketing_legal_nav_label: 'Link legali',
    marketing_copyright: '© {year} VoiceFlow. Tutti i diritti riservati.',
    marketing_privacy: 'Privacy Policy',
    marketing_terms: 'Termini di Servizio',
    marketing_cookies: 'Cookie Policy',
    command_palette_title: 'Ricerca rapida',
    command_palette_description: "Cerca azioni e naviga nell'applicazione",
    command_palette_placeholder: 'Cerca azioni...',
    command_palette_no_results: 'Nessun risultato trovato.',
    command_palette_nav_group: 'Navigazione',
    confirm: 'Conferma',
    cancel: 'Annulla',
    loading: 'Attendere…',
    error_generic: 'Si è verificato un errore. Riprova.',
  },
  nav: {
    dashboard: 'Dashboard',
    campaigns: 'Campagne',
    contacts: 'Contatti',
    scripts: 'Script',
    credit: 'Credito',
    settings: 'Impostazioni',
    primary_nav_label: 'Navigazione principale',
  },
  auth: {
    user_menu_label: 'Menu utente',
    profile: 'Profilo',
    settings: 'Impostazioni',
    language: 'Lingua',
    theme: 'Tema',
    sign_out: 'Esci',
    default_user: 'Utente',
    theme_light: 'Chiaro',
    theme_dark: 'Scuro',
    theme_system: 'Sistema',
    locale_it: 'Italiano',
    locale_en: 'English',
  },
  credit: {
    top_up: 'Ricarica',
    total_purchased: 'Totale acquistati',
    credit_balance_label: 'Saldo crediti',
    reserved_active_calls: 'Riservati (chiamate attive)',
    available: 'Disponibili',
    pill_aria_label: 'Saldo crediti: {minutes} minuti rimanenti',
  },
  table: {
    columns: 'Colonne',
    visible_columns: 'Colonne visibili',
    rows_per_page: 'Righe per pagina',
    rows_selected: '{selected} di {total} riga/e selezionata/e',
    total_rows: '{total} riga/e totali',
    page_of: 'Pagina {page} di {total}',
    first_page: 'Prima pagina',
    prev_page: 'Pagina precedente',
    next_page: 'Pagina successiva',
    last_page: 'Ultima pagina',
  },
  errors: {
    title: 'Errore',
    message: 'Si è verificato un errore imprevisto.',
    retry: 'Riprova',
  },
  status: {
    draft: 'Bozza',
    scheduled: 'Pianificata',
    running: 'In corso',
    paused: 'In pausa',
    completed: 'Completata',
    cancelled: 'Annullata',
    error: 'Errore',
    pending: 'In attesa',
    dialing: 'In chiamata',
    in_progress: 'In corso',
    failed: 'Fallita',
    no_answer: 'Senza risposta',
    voicemail: 'Segreteria',
    busy: 'Occupato',
    processing: 'In elaborazione',
    succeeded: 'Completato',
    refunded: 'Rimborsato',
    active: 'Attivo',
    opted_out: 'Opt-out',
    pending_review: 'In revisione',
    compliant: 'Conforme',
    warning: 'Avviso',
    blocked: 'Bloccato',
    expired: 'Scaduto',
  },
};

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace: string) => {
    return (key: string, params?: Record<string, string | number>) => {
      const ns = _italianStrings[namespace];
      let msg = ns?.[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          msg = msg.replace(`{${k}}`, String(v));
        }
      }
      return msg;
    };
  }),
  useLocale: vi.fn(() => 'it'),
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
}));
