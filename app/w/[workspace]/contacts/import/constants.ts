import type { ImportSummary } from "@/lib/repos/contacts";

// A "use server" module may only export async functions, so the shared
// constants and types for the importer live here instead.

export const IMPORT_ROW_LIMIT = 5000;

export type ImportField =
  | "email"
  | "phone"
  | "firstName"
  | "lastName"
  | "company"
  | "jobTitle"
  | "skip";

export interface ImportResult {
  error?: string;
  summary?: ImportSummary;
}
