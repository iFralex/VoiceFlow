import type { ColumnMapping, ConsentBasis, ContactType } from '@/lib/services/csv';

export const CONTACTS_IMPORT_REQUESTED = 'contacts/import-requested' as const;
export const CONTACTS_IMPORT_COMPLETED = 'contacts/import-completed' as const;

export interface ContactsImportRequestedData {
  orgId: string;
  listId: string;
  storagePath: string;
  columnMapping?: ColumnMapping;
  consentBasis: ConsentBasis;
  contactType?: ContactType;
  consentEvidence?: string;
}

export interface ContactsImportCompletedData {
  orgId: string;
  listId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedCount: number;
  updatedCount: number;
  status: 'completed' | 'failed';
}
