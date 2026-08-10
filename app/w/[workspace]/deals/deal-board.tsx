"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Badge, Card, Field, Input, Select } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { createDealAction, moveDealAction, type DealState } from "./actions";
import { cn, formatCurrency } from "@/lib/utils";

interface DealCard {
  id: string;
  title: string;
  value: number;
  currency: string;
  contactName: string | null;
  contactId: string | null;
}

interface Column {
  stage: { id: string; name: string; isWon: boolean; isLost: boolean };
  total: number;
  deals: DealCard[];
}

export function DealBoard({
  workspace,
  columns,
  contacts,
}: {
  workspace: string;
  columns: Column[];
  contacts: Array<{ id: string; name: string }>;
}) {
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  // Optimistic move so the card lands under the cursor immediately; the server
  // action revalidates and reconciles.
  const [optimistic, applyOptimistic] = useOptimistic(
    columns,
    (current, move: { dealId: string; toStageId: string }) => {
      const deal = current
        .flatMap((column) => column.deals)
        .find((candidate) => candidate.id === move.dealId);
      if (!deal) return current;

      return current.map((column) => {
        const without = column.deals.filter(
          (candidate) => candidate.id !== move.dealId,
        );
        const deals =
          column.stage.id === move.toStageId ? [...without, deal] : without;
        return {
          ...column,
          deals,
          total: deals.reduce((sum, item) => sum + item.value, 0),
        };
      });
    },
  );

  const sensors = useSensors(
    // A small threshold keeps a click on the card title from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;

    const from = optimistic.find((column) =>
      column.deals.some((deal) => deal.id === dealId),
    );
    if (!from || from.stage.id === toStageId) return;

    const target = optimistic.find((column) => column.stage.id === toStageId);
    const beforeDealId = target?.deals.at(-1)?.id ?? null;

    startTransition(async () => {
      applyOptimistic({ dealId, toStageId });
      const result = await moveDealAction(workspace, dealId, toStageId, {
        beforeDealId,
        afterDealId: null,
      });
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {optimistic.map((column) => (
          <StageColumn
            key={column.stage.id}
            column={column}
            workspace={workspace}
            contacts={contacts}
            adding={adding === column.stage.id}
            onToggleAdd={() =>
              setAdding(adding === column.stage.id ? null : column.stage.id)
            }
          />
        ))}
      </div>
    </DndContext>
  );
}

function StageColumn({
  column,
  workspace,
  contacts,
  adding,
  onToggleAdd,
}: {
  column: Column;
  workspace: string;
  contacts: Array<{ id: string; name: string }>;
  adding: boolean;
  onToggleAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });

  return (
    <div className="w-72 shrink-0">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{column.stage.name}</span>
          {column.stage.isWon ? <Badge variant="success">Won</Badge> : null}
          {column.stage.isLost ? (
            <Badge variant="destructive">Lost</Badge>
          ) : null}
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {column.deals.length} · {formatCurrency(column.total)}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/40 min-h-24 space-y-2 rounded-lg p-2 transition-colors",
          isOver && "bg-accent ring-primary/40 ring-2",
        )}
      >
        {column.deals.map((deal) => (
          <DealTile key={deal.id} deal={deal} workspace={workspace} />
        ))}

        {adding ? (
          <NewDealForm
            workspace={workspace}
            stageId={column.stage.id}
            contacts={contacts}
            onDone={onToggleAdd}
          />
        ) : (
          <button
            type="button"
            onClick={onToggleAdd}
            className="text-muted-foreground hover:text-foreground hover:bg-card w-full rounded-md border border-dashed border-border py-2 text-xs transition-colors"
          >
            + Add deal
          </button>
        )}
      </div>
    </div>
  );
}

function DealTile({
  deal,
  workspace,
}: {
  deal: DealCard;
  workspace: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deal.id });

  return (
    <Card
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "cursor-grab space-y-1 p-3 active:cursor-grabbing",
        isDragging && "opacity-60 shadow-lg",
      )}
      {...listeners}
      {...attributes}
    >
      <p className="text-sm leading-snug font-medium">{deal.title}</p>
      <div className="flex items-center justify-between gap-2">
        {deal.contactId ? (
          <Link
            href={`/w/${workspace}/contacts/${deal.contactId}`}
            className="text-muted-foreground hover:text-foreground truncate text-xs hover:underline"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {deal.contactName}
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs">No contact</span>
        )}
        <span className="text-xs font-medium tabular-nums">
          {formatCurrency(deal.value, deal.currency)}
        </span>
      </div>
    </Card>
  );
}

const EMPTY: DealState = {};

function NewDealForm({
  workspace,
  stageId,
  contacts,
  onDone,
}: {
  workspace: string;
  stageId: string;
  contacts: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(EMPTY.error);

  return (
    <Card className="space-y-2 p-3">
      <form
        action={(formData) => {
          startTransition(async () => {
            const result = await createDealAction(EMPTY, formData);
            if (result.error) setError(result.error);
            else {
              toast.success(result.success ?? "Deal created");
              onDone();
            }
          });
        }}
        className="space-y-2"
      >
        <input type="hidden" name="workspace" value={workspace} />
        <input type="hidden" name="stageId" value={stageId} />

        <Field label="Title">
          <Input name="title" required placeholder="New retainer" />
        </Field>
        <Field label="Value">
          <Input name="value" type="number" min={0} step={100} defaultValue={0} />
        </Field>
        <Field label="Contact">
          <Select name="contactId" defaultValue="">
            <option value="">None</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </Select>
        </Field>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Add"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
