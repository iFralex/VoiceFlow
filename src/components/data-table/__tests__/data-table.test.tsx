import { type ColumnDef } from '@tanstack/react-table';
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DataTable } from '@/components/data-table';
import { DataTableEmpty } from '@/components/data-table/empty';
import { DataTableError } from '@/components/data-table/error';
import { DataTableSkeleton } from '@/components/data-table/skeleton';

afterEach(cleanup);

// ─── Minimal test data ────────────────────────────────────────────────────────

type Person = {
  id: string;
  name: string;
  email: string;
};

const COLUMNS: ColumnDef<Person>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: 'Nome' },
  { accessorKey: 'email', header: 'Email' },
];

const DATA: Person[] = [
  { id: '1', name: 'Alice Rossi', email: 'alice@example.com' },
  { id: '2', name: 'Bob Bianchi', email: 'bob@example.com' },
];

// ─── DataTableEmpty ───────────────────────────────────────────────────────────

describe('DataTableEmpty', () => {
  it('renders default title and description', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableEmpty columnCount={3} />
        </tbody>
      </table>,
    );
    const el = container.querySelector('[data-slot="data-table-empty"]')!;
    expect(el).toBeInTheDocument();
    expect(within(el as HTMLElement).getByText('Nessun risultato')).toBeInTheDocument();
    expect(within(el as HTMLElement).getByText('Non ci sono dati da mostrare.')).toBeInTheDocument();
  });

  it('renders custom title and description', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableEmpty
            columnCount={3}
            title="Nessun contatto"
            description="Aggiungi il primo contatto."
          />
        </tbody>
      </table>,
    );
    const el = container.querySelector('[data-slot="data-table-empty"]')!;
    expect(within(el as HTMLElement).getByText('Nessun contatto')).toBeInTheDocument();
    expect(within(el as HTMLElement).getByText('Aggiungi il primo contatto.')).toBeInTheDocument();
  });

  it('renders action slot', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableEmpty
            columnCount={3}
            action={<button>Aggiungi</button>}
          />
        </tbody>
      </table>,
    );
    const el = container.querySelector('[data-slot="data-table-empty"]')!;
    expect(within(el as HTMLElement).getByRole('button', { name: 'Aggiungi' })).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableEmpty columnCount={3} />
        </tbody>
      </table>,
    );
    expect(container.querySelector('[data-slot="data-table-empty"]')).toBeInTheDocument();
  });
});

// ─── DataTableError ───────────────────────────────────────────────────────────

describe('DataTableError', () => {
  it('renders default error message', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableError columnCount={3} />
        </tbody>
      </table>,
    );
    const el = container.querySelector('[data-slot="data-table-error"]')!;
    expect(within(el as HTMLElement).getByText('Errore di caricamento')).toBeInTheDocument();
    expect(
      within(el as HTMLElement).getByText(
        'Si è verificato un errore durante il caricamento dei dati.',
      ),
    ).toBeInTheDocument();
  });

  it('renders custom error message', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableError columnCount={3} message="Server non raggiungibile" />
        </tbody>
      </table>,
    );
    const el = container.querySelector('[data-slot="data-table-error"]')!;
    expect(within(el as HTMLElement).getByText('Server non raggiungibile')).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableError columnCount={3} />
        </tbody>
      </table>,
    );
    expect(container.querySelector('[data-slot="data-table-error"]')).toBeInTheDocument();
  });
});

// ─── DataTableSkeleton ────────────────────────────────────────────────────────

describe('DataTableSkeleton', () => {
  it('renders the correct number of skeleton rows', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableSkeleton columnCount={3} rowCount={4} />
        </tbody>
      </table>,
    );
    const rows = container.querySelectorAll('[data-slot="data-table-skeleton-row"]');
    expect(rows).toHaveLength(4);
  });

  it('renders the correct number of cells per row', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableSkeleton columnCount={3} rowCount={1} />
        </tbody>
      </table>,
    );
    const row = container.querySelector('[data-slot="data-table-skeleton-row"]')!;
    expect((row as HTMLElement).querySelectorAll('td')).toHaveLength(3);
  });

  it('uses 5 rows by default', () => {
    const { container } = render(
      <table>
        <tbody>
          <DataTableSkeleton columnCount={2} />
        </tbody>
      </table>,
    );
    const rows = container.querySelectorAll('[data-slot="data-table-skeleton-row"]');
    expect(rows).toHaveLength(5);
  });
});

// ─── DataTable ────────────────────────────────────────────────────────────────

describe('DataTable', () => {
  it('renders column headers', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(within(container as HTMLElement).getByText('ID')).toBeInTheDocument();
    expect(within(container as HTMLElement).getByText('Nome')).toBeInTheDocument();
    expect(within(container as HTMLElement).getByText('Email')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(within(container as HTMLElement).getByText('Alice Rossi')).toBeInTheDocument();
    expect(within(container as HTMLElement).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(container as HTMLElement).getByText('Bob Bianchi')).toBeInTheDocument();
  });

  it('renders loading state when isLoading=true', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={[]} isLoading />,
    );
    const skeletons = container.querySelectorAll('[data-slot="data-table-skeleton-row"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-slot="data-table-empty"]')).not.toBeInTheDocument();
  });

  it('renders error state when error is provided', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={[]} error="Connessione fallita" />,
    );
    const el = container.querySelector('[data-slot="data-table-error"]')!;
    expect(el).toBeInTheDocument();
    expect(within(el as HTMLElement).getByText('Connessione fallita')).toBeInTheDocument();
  });

  it('renders empty state when data is empty', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={[]} />);
    expect(container.querySelector('[data-slot="data-table-empty"]')).toBeInTheDocument();
  });

  it('renders custom empty title and description', () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={[]}
        emptyTitle="Nessuna campagna"
        emptyDescription="Crea la prima campagna."
      />,
    );
    const el = container.querySelector('[data-slot="data-table-empty"]')!;
    expect(within(el as HTMLElement).getByText('Nessuna campagna')).toBeInTheDocument();
    expect(within(el as HTMLElement).getByText('Crea la prima campagna.')).toBeInTheDocument();
  });

  it('renders pagination by default', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(within(container as HTMLElement).getByLabelText('Prima pagina')).toBeInTheDocument(); // mock returns Italian
  });

  it('hides pagination when showPagination=false', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} showPagination={false} />,
    );
    expect(within(container as HTMLElement).queryByLabelText('Prima pagina')).not.toBeInTheDocument();
  });

  it('renders toolbar slot', () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        toolbar={<input placeholder="Cerca contatti" />}
      />,
    );
    expect(
      within(container as HTMLElement).getByPlaceholderText('Cerca contatti'),
    ).toBeInTheDocument();
  });

  it('does not render toolbar when prop is omitted', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(within(container as HTMLElement).queryByText('Colonne')).not.toBeInTheDocument();
  });
});
