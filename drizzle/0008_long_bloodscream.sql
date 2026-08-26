CREATE TABLE "arshin_verification_buffer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"batch_id" uuid,
	"vri_id" varchar(100) NOT NULL,
	"org_title" text NOT NULL,
	"mit_number" varchar(100) NOT NULL,
	"verification_date" timestamp NOT NULL,
	"valid_date" timestamp,
	"doc_num" varchar NOT NULL,
	"applicability" boolean NOT NULL,
	"is_recommended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arshin_verification_buffer_vri_id_unique" UNIQUE("vri_id")
);
--> statement-breakpoint
ALTER TABLE "arshin_verification_buffer" ADD CONSTRAINT "arshin_verification_buffer_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arshin_verification_buffer" ADD CONSTRAINT "arshin_verification_buffer_batch_id_verification_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."verification_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avb_device_id_idx" ON "arshin_verification_buffer" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "avb_batch_id_idx" ON "arshin_verification_buffer" USING btree ("batch_id");