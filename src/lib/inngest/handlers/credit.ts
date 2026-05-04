/**
 * Inngest event type definitions for credit-related events.
 *
 * The actual handler that sends the "Credito basso" email is implemented
 * in plan 09/13 once the Inngest SDK and email adapter are wired up.
 */

export const CREDIT_LOW_BALANCE_EVENT = 'credit/low-balance' as const;

export interface CreditLowBalanceData {
  orgId: string;
  balanceCents: number;
  remainingMinutes: number;
}
