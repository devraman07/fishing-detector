import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
export const scanLogs = pgTable("scan_logs", {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    result: text("result").notNull(),
    confidence: real("confidence").notNull(),
    timestamp: timestamp("timestamp").defaultNow()
});
