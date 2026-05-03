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
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  SENTRY_DSN: z.string().url().optional(),
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
  OPENAI_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_ENDPOINT: z.string().url().optional(),
  INTERNAL_WEBHOOK_SECRET: z.string().min(32),
});

export const env =
  process.env['SKIP_ENV_VALIDATION'] === 'true'
    ? (process.env as unknown as z.infer<typeof Env>)
    : Env.parse(process.env);
