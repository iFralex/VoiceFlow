export {
  leadReactivationSchema,
  leadReactivationJsonSchema,
  type LeadReactivationVariables,
} from './lead-reactivation.schema';

export {
  appointmentConfirmSchema,
  appointmentConfirmJsonSchema,
  type AppointmentConfirmVariables,
} from './appointment-confirm.schema';

export {
  carRenewalSchema,
  carRenewalJsonSchema,
  type CarRenewalVariables,
} from './car-renewal.schema';

export {
  postSaleFollowupSchema,
  postSaleFollowupJsonSchema,
  type PostSaleFollowupVariables,
} from './post-sale-followup.schema';

export {
  csiSurveySchema,
  csiSurveyJsonSchema,
  type CsiSurveyVariables,
} from './csi-survey.schema';

export const TEMPLATE_SCHEMAS = {
  'lead-reactivation': {
    zod: () => import('./lead-reactivation.schema').then((m) => m.leadReactivationSchema),
    json: () => import('./lead-reactivation.schema').then((m) => m.leadReactivationJsonSchema),
  },
  'appointment-confirm': {
    zod: () => import('./appointment-confirm.schema').then((m) => m.appointmentConfirmSchema),
    json: () => import('./appointment-confirm.schema').then((m) => m.appointmentConfirmJsonSchema),
  },
  'car-renewal': {
    zod: () => import('./car-renewal.schema').then((m) => m.carRenewalSchema),
    json: () => import('./car-renewal.schema').then((m) => m.carRenewalJsonSchema),
  },
  'post-sale-followup': {
    zod: () => import('./post-sale-followup.schema').then((m) => m.postSaleFollowupSchema),
    json: () => import('./post-sale-followup.schema').then((m) => m.postSaleFollowupJsonSchema),
  },
  'csi-survey': {
    zod: () => import('./csi-survey.schema').then((m) => m.csiSurveySchema),
    json: () => import('./csi-survey.schema').then((m) => m.csiSurveyJsonSchema),
  },
} as const;

export type TemplateSlug = keyof typeof TEMPLATE_SCHEMAS;
