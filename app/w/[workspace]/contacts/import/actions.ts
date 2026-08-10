"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, writeAuditLog } from "@/lib/tenant";
import { importContacts, type ImportRow } from "@/lib/repos/contacts";
import {
  IMPORT_ROW_LIMIT,
  type ImportField,
  type ImportResult,
} from "./constants";

/**
 * Apply a parsed CSV. The file is parsed in the browser and only the mapped
 * rows are posted, so a large upload never has to survive a server round trip
 * as raw text.
 */
export async function runImportAction(input: {
  workspace: string;
  rows: Array<Record<string, string>>;
  mapping: Record<string, ImportField>;
  tagIds: string[];
  listIds: string[];
}): Promise<ImportResult> {
  const ctx = await requirePermission(input.workspace, "contact:import");

  if (input.rows.length === 0) {
    return { error: "That file had no data rows." };
  }
  if (input.rows.length > IMPORT_ROW_LIMIT) {
    return {
      error: `That file has ${input.rows.length.toLocaleString()} rows. Split it into chunks of ${IMPORT_ROW_LIMIT.toLocaleString()} or fewer.`,
    };
  }

  const mapped: ImportRow[] = input.rows.map((row) => {
    const output: ImportRow = {};
    for (const [column, field] of Object.entries(input.mapping)) {
      if (field === "skip") continue;
      const value = row[column]?.trim();
      if (value) output[field] = value;
    }
    return output;
  });

  const hasIdentifier = Object.values(input.mapping).some(
    (field) => field === "email" || field === "phone",
  );
  if (!hasIdentifier) {
    return { error: "Map at least one column to Email or Phone." };
  }

  const summary = await importContacts(ctx, mapped, {
    tagIds: input.tagIds,
    listIds: input.listIds,
    source: "csv-import",
  });

  await writeAuditLog(ctx, "contact.imported", {
    metadata: {
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
    },
  });

  revalidatePath(`/w/${input.workspace}/contacts`);
  return { summary };
}
