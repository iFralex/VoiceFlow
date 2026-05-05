export const CAMPAIGN_LAUNCHED_EVENT = 'campaign/launched' as const;
export const CAMPAIGN_DISPATCH_CALL_EVENT = 'campaign/dispatch-call' as const;
export const CAMPAIGN_COMPLETED_EVENT = 'campaign/completed' as const;

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
