import { NextResponse } from "next/server";
import { requirePermission, TenantAccessError } from "@/lib/tenant";
import { listContactsForExport } from "@/lib/repos/contacts";

const COLUMNS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "jobTitle",
  "status",
  "source",
  "tags",
  "createdAt",
  "lastActivityAt",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Quote whenever the value could otherwise break the row.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await params;

  let contacts;
  try {
    const ctx = await requirePermission(workspace, "contact:export");
    contacts = await listContactsForExport(ctx);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const lines = [COLUMNS.join(",")];
  for (const contact of contacts) {
    lines.push(
      [
        contact.id,
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.phone,
        contact.company,
        contact.jobTitle,
        contact.status,
        contact.source,
        contact.tags.map((link) => link.tag.name).join("; "),
        contact.createdAt,
        contact.lastActivityAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${workspace}-contacts-${stamp}.csv"`,
      // Never let a CDN or browser cache one tenant's export.
      "Cache-Control": "no-store, private",
    },
  });
}

export const dynamic = "force-dynamic";
