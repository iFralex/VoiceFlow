import Link from 'next/link';

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/termini', label: 'Termini di Servizio' },
  { href: '/cookie', label: 'Cookie Policy' },
] as const;

const CURRENT_YEAR = new Date().getFullYear();

export function MarketingFooter() {
  return (
    <footer
      data-testid="marketing-footer"
      className="border-t bg-background"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 md:flex-row md:justify-between">
        {/* Copyright */}
        <p className="text-sm text-muted-foreground">
          © {CURRENT_YEAR} VoiceFlow. Tutti i diritti riservati.
        </p>

        {/* Legal links */}
        <nav aria-label="Link legali" className="flex flex-wrap justify-center gap-4 md:justify-end">
          {LEGAL_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
