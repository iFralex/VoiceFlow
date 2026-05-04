CREATE TABLE "voice_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "call_provider" NOT NULL,
	"external_voice_id" text NOT NULL,
	"display_name" text NOT NULL,
	"language" text DEFAULT 'it-IT' NOT NULL,
	"gender" text,
	"style" text,
	"sample_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"default_for_templates" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_catalogue_external_voice_id_provider_unique" UNIQUE("external_voice_id","provider")
);
