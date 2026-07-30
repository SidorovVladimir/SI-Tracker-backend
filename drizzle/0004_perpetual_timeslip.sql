CREATE TYPE "public"."device_document_type" AS ENUM('manual', 'passport');--> statement-breakpoint
CREATE TABLE "device_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(100),
	"type" "device_document_type" NOT NULL,
	"device_id" uuid,
	"grsi_number" varchar(100),
	"model_name" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_documents" ADD CONSTRAINT "device_documents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_device_id_idx" ON "device_documents" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "doc_grsi_model_idx" ON "device_documents" USING btree ("grsi_number","model_name");