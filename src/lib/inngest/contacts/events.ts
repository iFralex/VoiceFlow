import type { RpoStatus } from '@/lib/services/contacts';
import type { ColumnMapping, ConsentBasis, ContactType } from '@/lib/services/csv';

export const CONTACTS_IMPORT_REQUESTED = 'contacts/import-requested' as const;
export const CONTACTS_IMPORT_COMPLETED = 'contacts/import-completed' as const;
export const CONTACTS_EXPORT_REQUESTED = 'contacts/export-requested' as const;
export const CONTACTS_EXPORT_COMPLETED = 'contacts/export-completed' as const;

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

export interface ContactsExportRequestedData {
  orgId: string;
  exportId: string;
  requestedByUserId: string;
  filters: {
    listId?: string;
    optOut?: boolean;
    rpoStatus?: RpoStatus;
    search?: string;
  };
}

export interface ContactsExportCompletedData {
  orgId: string;
  exportId: string;
  storagePath: string;
  rowCount: number;
  status: 'completed' | 'failed';
}
