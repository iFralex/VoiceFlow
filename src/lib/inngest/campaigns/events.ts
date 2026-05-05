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
}

export interface CampaignCompletedData {
  campaignId: string;
  orgId: string;
}
