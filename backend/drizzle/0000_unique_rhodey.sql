CREATE TABLE "scan_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"result" text NOT NULL,
	"confidence" real NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
