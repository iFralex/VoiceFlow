CREATE TYPE "public"."user_locale" AS ENUM('it', 'en');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."list_source" AS ENUM('csv-upload', 'zapier', 'api');--> statement-breakpoint
CREATE TYPE "public"."consent_basis" AS ENUM('consent', 'legitimate_interest', 'existing_customer');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('b2c', 'b2b');--> statement-breakpoint
CREATE TYPE "public"."rpo_status" AS ENUM('clear', 'blocked', 'unchecked');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('interested', 'not_interested', 'appointment_booked', 'wrong_number', 'callback_requested', 'voicemail_left', 'do_not_call');--> statement-breakpoint
CREATE TYPE "public"."call_provider" AS ENUM('vapi', 'retell', 'proprietary');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('pending', 'dialing', 'in_progress', 'completed', 'failed', 'no_answer', 'voicemail', 'busy');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_type" AS ENUM('topup', 'reservation', 'release', 'charge', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."opt_out_source" AS ENUM('call_outcome', 'dealer_input', 'gdpr_request', 'inbound_ivr');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."webhook_provider" AS ENUM('stripe', 'vapi', 'retell', 'twilio');--> statement-breakpoint
CREATE TYPE "public"."phone_provider" AS ENUM('voiped', 'twilio', 'telnyx');--> statement-breakpoint
CREATE TYPE "public"."phone_status" AS ENUM('active', 'cooling_down', 'retired');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"vat_number" text,
	"country" text DEFAULT 'IT' NOT NULL,
	"timezone" text DEFAULT 'Europe/Rome' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"locale" "user_locale" DEFAULT 'it' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "script_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"system_prompt" text NOT NULL,
	"variable_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_voice_id" text,
	"default_language" text DEFAULT 'it-IT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_templates_slug_version_unique" UNIQUE("slug","version")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "list_source" NOT NULL,
	"source_file_path" text,
	"total_count" integer DEFAULT 0 NOT NULL,
	"valid_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_list_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"consent_basis" "consent_basis" NOT NULL,
	"consent_evidence" text,
	"contact_type" "contact_type" DEFAULT 'b2c' NOT NULL,
	"rpo_status" "rpo_status" DEFAULT 'unchecked' NOT NULL,
	"rpo_checked_at" timestamp with time zone,
	"opt_out" boolean DEFAULT false NOT NULL,
	"opt_out_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"contact_list_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"concurrency_limit" integer DEFAULT 5 NOT NULL,
	"time_window_start" time DEFAULT '09:00' NOT NULL,
	"time_window_end" time DEFAULT '19:00' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"estimated_max_cents" integer,
	"actual_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" "call_provider" NOT NULL,
	"provider_call_id" text,
	"status" "call_status" DEFAULT 'pending' NOT NULL,
	"outcome" "call_outcome",
	"outcome_confidence" numeric(3, 2),
	"billable_seconds" integer,
	"cost_cents" integer,
	"recording_path" text,
	"transcript_path" text,
	"transferred_to_agent" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"notes" text,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"included_minutes" integer NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "credit_packages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entry_type" "credit_entry_type" NOT NULL,
	"delta_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key" UNIQUE NULLS NOT DISTINCT("org_id","reference_type","reference_id","entry_type")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"stripe_session_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "opt_out_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"source" "opt_out_source" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opt_out_registry_org_phone_key" UNIQUE("org_id","phone_e164")
);
--> statement-breakpoint
CREATE TABLE "rpo_snapshots" (
	"phone_e164" text PRIMARY KEY NOT NULL,
	"is_blocked" boolean NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "webhook_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_provider_event_id_key" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"e164" text NOT NULL,
	"org_id" uuid,
	"provider" "phone_provider" NOT NULL,
	"status" "phone_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"daily_call_count" integer DEFAULT 0 NOT NULL,
	"spam_score" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_numbers_e164_unique" UNIQUE("e164")
);
--> statement-breakpoint
CREATE TABLE "webhooks_outgoing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_template_id_script_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."script_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_list_id_contact_lists_id_fk" FOREIGN KEY ("contact_list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_contact_list_id_contact_lists_id_fk" FOREIGN KEY ("contact_list_id") REFERENCES "public"."contact_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_credit_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."credit_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_out_registry" ADD CONSTRAINT "opt_out_registry_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks_outgoing" ADD CONSTRAINT "webhooks_outgoing_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_outgoing_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks_outgoing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_org_id_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "script_templates_slug_idx" ON "script_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "scripts_org_id_idx" ON "scripts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contact_lists_org_id_idx" ON "contact_lists" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_phone_unique_idx" ON "contacts" USING btree ("org_id","phone_e164") WHERE "contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "contacts_contact_list_id_idx" ON "contacts" USING btree ("contact_list_id");--> statement-breakpoint
CREATE INDEX "contacts_org_opt_out_rpo_idx" ON "contacts" USING btree ("org_id","opt_out","rpo_status");--> statement-breakpoint
CREATE INDEX "campaigns_org_id_idx" ON "campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "calls_org_campaign_status_idx" ON "calls" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "calls_org_contact_idx" ON "calls" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "calls_provider_call_id_idx" ON "calls" USING btree ("provider_call_id") WHERE "calls"."provider_call_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_org_scheduled_at_idx" ON "appointments" USING btree ("org_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_at_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "opt_out_registry_org_id_idx" ON "opt_out_registry" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_at_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action") WHERE "audit_log"."action" IN ('call.completed', 'payment.succeeded', 'contact.opted_out', 'member.invited', 'member.removed');--> statement-breakpoint
CREATE INDEX "phone_numbers_org_status_active_idx" ON "phone_numbers" USING btree ("org_id","status") WHERE "phone_numbers"."status" = 'active';--> statement-breakpoint
CREATE INDEX "webhooks_outgoing_org_id_idx" ON "webhooks_outgoing" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_delivered_at_idx" ON "webhook_deliveries" USING btree ("delivered_at");