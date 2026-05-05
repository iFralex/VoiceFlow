export {
  bookAppointmentJsonSchema,
  handleBookAppointment,
  type BookAppointmentArgs,
} from './book_appointment';

export {
  markNotInterestedJsonSchema,
  handleMarkNotInterested,
  type MarkNotInterestedArgs,
} from './mark_not_interested';

export {
  markWrongNumberJsonSchema,
  handleMarkWrongNumber,
  type MarkWrongNumberArgs,
} from './mark_wrong_number';

export {
  requestCallbackJsonSchema,
  handleRequestCallback,
  type RequestCallbackArgs,
} from './request_callback';

export {
  transferToHumanAgentJsonSchema,
  handleTransferToHumanAgent,
  type TransferToHumanAgentArgs,
} from './transfer_to_human_agent';

export {
  registerOptOutJsonSchema,
  handleRegisterOptOut,
  type RegisterOptOutArgs,
} from './register_opt_out';

export {
  confirmAppointmentJsonSchema,
  handleConfirmAppointment,
  type ConfirmAppointmentArgs,
} from './confirm_appointment';

export {
  rescheduleAppointmentJsonSchema,
  handleRescheduleAppointment,
  type RescheduleAppointmentArgs,
} from './reschedule_appointment';

export {
  submitSurveyResponseJsonSchema,
  handleSubmitSurveyResponse,
  type SubmitSurveyResponseArgs,
} from './submit_survey_response';

// ---------------------------------------------------------------------------
// Per-template tool selection
// ---------------------------------------------------------------------------

import { bookAppointmentJsonSchema } from './book_appointment';
import { confirmAppointmentJsonSchema } from './confirm_appointment';
import { markNotInterestedJsonSchema } from './mark_not_interested';
import { markWrongNumberJsonSchema } from './mark_wrong_number';
import { registerOptOutJsonSchema } from './register_opt_out';
import { requestCallbackJsonSchema } from './request_callback';
import { rescheduleAppointmentJsonSchema } from './reschedule_appointment';
import { submitSurveyResponseJsonSchema } from './submit_survey_response';
import { transferToHumanAgentJsonSchema } from './transfer_to_human_agent';

/** JSON Schema tool definitions for the LLM, keyed by template slug. */
export const TEMPLATE_TOOLS = {
  /** lead-reactivation uses all six base tools */
  'lead-reactivation': [
    bookAppointmentJsonSchema,
    markNotInterestedJsonSchema,
    markWrongNumberJsonSchema,
    requestCallbackJsonSchema,
    transferToHumanAgentJsonSchema,
    registerOptOutJsonSchema,
  ],

  /**
   * appointment-confirm: no booking flow (appointment exists); focus on
   * confirm / reschedule / cancel + escalation + opt-out.
   */
  'appointment-confirm': [
    confirmAppointmentJsonSchema,
    rescheduleAppointmentJsonSchema,
    markNotInterestedJsonSchema,
    markWrongNumberJsonSchema,
    transferToHumanAgentJsonSchema,
    requestCallbackJsonSchema,
    registerOptOutJsonSchema,
  ],

  /**
   * car-renewal: renewal consultancy — can book, mark interest outcomes,
   * handle opt-outs and callbacks.
   */
  'car-renewal': [
    bookAppointmentJsonSchema,
    markNotInterestedJsonSchema,
    markWrongNumberJsonSchema,
    requestCallbackJsonSchema,
    transferToHumanAgentJsonSchema,
    registerOptOutJsonSchema,
  ],

  /**
   * post-sale-followup: satisfaction check; can escalate to human if issues
   * arise and book a service appointment.
   */
  'post-sale-followup': [
    bookAppointmentJsonSchema,
    markNotInterestedJsonSchema,
    markWrongNumberJsonSchema,
    requestCallbackJsonSchema,
    transferToHumanAgentJsonSchema,
    registerOptOutJsonSchema,
  ],

  /**
   * csi-survey: structured questionnaire; primary tool is survey submission.
   * Escape hatches: callback, wrong number, not interested, transfer, opt-out.
   */
  'csi-survey': [
    submitSurveyResponseJsonSchema,
    markNotInterestedJsonSchema,
    markWrongNumberJsonSchema,
    requestCallbackJsonSchema,
    transferToHumanAgentJsonSchema,
    registerOptOutJsonSchema,
  ],
} as const;

export type TemplateToolSlug = keyof typeof TEMPLATE_TOOLS;
