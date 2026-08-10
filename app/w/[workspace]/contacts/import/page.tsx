import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { listLists, listTags } from "@/lib/repos/crm";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import contacts" };

export default async function ImportPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);
  const [tags, lists] = await Promise.all([listTags(ctx), listLists(ctx)]);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/w/${workspace}/contacts`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> All contacts
      </Link>

      <PageHeader
        title="Import contacts"
        description="Upload a CSV, map the columns, and we'll merge it into this client's CRM. Rows matching an existing email or phone are updated instead of duplicated."
      />

      <ImportWizard
        workspace={workspace}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        lists={lists.map((list) => ({ id: list.id, name: list.name }))}
      />
    </div>
  );
}
