export const CAMPAIGN_LAUNCHED_EVENT = 'campaign/launched' as const;
export const CAMPAIGN_DISPATCH_CALL_EVENT = 'campaign/dispatch-call' as const;
export const CAMPAIGN_COMPLETED_EVENT = 'campaign/completed' as const;
export const CAMPAIGN_EXPORT_REQUESTED_EVENT = 'campaign/export-requested' as const;
export const CAMPAIGN_EXPORT_COMPLETED_EVENT = 'campaign/export-completed' as const;
export const VOICE_PROVIDER_DEGRADED_EVENT = 'system/voice-provider-degraded' as const;

export interface CampaignLaunchedData {
  campaignId: string;
  orgId: string;
}

export interface CampaignDispatchCallData {
  campaignId: string;
  orgId: string;
  contactId: string;
  /** Pre-created call row ID (created in `pending` state at planning time) */
  callId: string;
  /** 1-based attempt number */
  attempt: number;
  /**
   * ISO-8601 datetime before which dispatch should not proceed.
   * Set on retry attempts to enforce the 48h minimum between attempts.
   * The dispatch handler returns `{ sleepUntil }` when this is in the future.
   */
  scheduledFor?: string;
}

export interface CampaignCompletedData {
  campaignId: string;
  orgId: string;
}

export interface CampaignExportFilters {
  outcomes?: string[];
  durationMinSeconds?: number;
  durationMaxSeconds?: number;
  /** ISO-8601 datetime — calls started at or after this instant */
  startedAfter?: string;
  /** ISO-8601 datetime — calls started at or before this instant */
  startedBefore?: string;
  /** When set, restrict export to these specific call ids */
  callIds?: string[];
}

export interface CampaignExportRequestedData {
  orgId: string;
  campaignId: string;
  exportId: string;
  requestedByUserId: string;
  filters: CampaignExportFilters;
}

export interface CampaignExportCompletedData {
  orgId: string;
  campaignId: string;
  exportId: string;
  storagePath: string;
  rowCount: number;
  status: 'completed' | 'failed';
}

export interface VoiceProviderDegradedData {
  orgId: string;
  campaignId: string;
  /** Number of provider_error calls in the detection window */
  errorCount: number;
  /** Total terminal calls in the same window */
  totalCount: number;
  /** Error rate as a decimal (e.g. 0.06 for 6%) */
  errorRate: number;
}
