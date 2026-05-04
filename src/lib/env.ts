import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_PRICE_TEST: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_SCALE: z.string().optional(),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM_ADDRESS: z.string().email(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  VOICE_PROVIDER: z.enum(['vapi', 'retell']).default('vapi'),
  VAPI_API_KEY: z.string().min(1).optional(),
  VAPI_WEBHOOK_SECRET: z.string().min(1).optional(),
  RETELL_API_KEY: z.string().min(1).optional(),
  RETELL_WEBHOOK_SECRET: z.string().min(1).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TELNYX_API_KEY: z.string().min(1).optional(),
  SBC_TRUNK_ID: z.string().optional(),
  SBC_AUTH_USER: z.string().optional(),
  SBC_AUTH_PASS: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_ENDPOINT: z.string().url().optional(),
  INTERNAL_WEBHOOK_SECRET: z.string().min(32),
  INTERNAL_ADMIN_TOKEN: z.string().min(32),
  CREDIT_SOFT_THRESHOLD_MINUTES: z.coerce.number().int().nonnegative().default(30),
  CREDIT_HARD_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(0),
});

// Convert empty strings to undefined so optional validators don't reject blank env vars
const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

export const env =
  process.env['SKIP_ENV_VALIDATION'] === 'true'
    ? (process.env as unknown as z.infer<typeof Env>)
    : Env.parse(rawEnv);
