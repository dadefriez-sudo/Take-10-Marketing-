import { KanbanSquare } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { getBoard, ensureDefaultPipeline } from "@/lib/repos/deals";
import { listContacts } from "@/lib/repos/contacts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCurrency, fullName } from "@/lib/utils";
import { DealBoard } from "./deal-board";

export const metadata = { title: "Deals" };

export default async function DealsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);

  // A workspace created before pipelines existed (or by an invite path that
  // skipped it) still needs a board to land on.
  await ensureDefaultPipeline(ctx.workspaceId);
  const board = await getBoard(ctx);

  if (!board) {
    return (
      <Card>
        <EmptyState
          icon={KanbanSquare}
          title="No pipeline yet"
          description="Something went wrong creating the default pipeline for this workspace."
        />
      </Card>
    );
  }

  const contacts = await listContacts(ctx, { pageSize: 100, sort: "recent" });
  const openTotal = board.columns
    .filter((column) => !column.stage.isWon && !column.stage.isLost)
    .reduce((sum, column) => sum + column.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deals"
        description={`${board.pipeline.name} · ${formatCurrency(
          openTotal,
        )} open across ${board.columns.reduce(
          (count, column) =>
            column.stage.isWon || column.stage.isLost
              ? count
              : count + column.deals.length,
          0,
        )} deals`}
      />

      <DealBoard
        workspace={workspace}
        columns={board.columns.map((column) => ({
          stage: {
            id: column.stage.id,
            name: column.stage.name,
            isWon: column.stage.isWon,
            isLost: column.stage.isLost,
          },
          total: column.total,
          deals: column.deals.map((deal) => ({
            id: deal.id,
            title: deal.title,
            value: Number(deal.value),
            currency: deal.currency,
            contactName: deal.contact ? fullName(deal.contact) : null,
            contactId: deal.contactId,
          })),
        }))}
        contacts={contacts.items.map((contact) => ({
          id: contact.id,
          name: fullName(contact),
        }))}
      />
    </div>
  );
}
