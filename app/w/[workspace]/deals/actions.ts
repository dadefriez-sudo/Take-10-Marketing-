"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/tenant";
import { createDeal, deleteDeal, moveDeal, updateDeal } from "@/lib/repos/deals";

export interface DealState {
  error?: string;
  success?: string;
}

const dealSchema = z.object({
  title: z.string().trim().min(1, "Give the deal a name").max(160),
  stageId: z.string().min(1),
  value: z.coerce.number().min(0).max(1_000_000_000).optional(),
  contactId: z.string().optional(),
});

export async function createDealAction(
  _prev: DealState,
  formData: FormData,
): Promise<DealState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "deal:write");

  const parsed = dealSchema.safeParse({
    title: formData.get("title"),
    stageId: formData.get("stageId"),
    value: formData.get("value") || 0,
    contactId: String(formData.get("contactId") ?? "") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  const deal = await createDeal(ctx, {
    title: parsed.data.title,
    stageId: parsed.data.stageId,
    value: parsed.data.value ?? 0,
    contactId: parsed.data.contactId ?? null,
  });

  if (!deal) return { error: "That stage or contact no longer exists" };

  revalidatePath(`/w/${workspace}/deals`);
  return { success: "Deal created" };
}

export async function moveDealAction(
  workspace: string,
  dealId: string,
  toStageId: string,
  neighbours: { beforeDealId?: string | null; afterDealId?: string | null },
): Promise<DealState> {
  const ctx = await requirePermission(workspace, "deal:write");
  const moved = await moveDeal(ctx, dealId, toStageId, neighbours);
  if (!moved) return { error: "That deal could not be moved" };

  revalidatePath(`/w/${workspace}/deals`);
  return { success: "Deal moved" };
}

export async function updateDealAction(
  workspace: string,
  dealId: string,
  input: { title?: string; value?: number },
): Promise<DealState> {
  const ctx = await requirePermission(workspace, "deal:write");
  const ok = await updateDeal(ctx, dealId, input);
  if (!ok) return { error: "That deal no longer exists" };

  revalidatePath(`/w/${workspace}/deals`);
  return { success: "Deal updated" };
}

export async function deleteDealAction(
  workspace: string,
  dealId: string,
): Promise<DealState> {
  const ctx = await requirePermission(workspace, "deal:write");
  await deleteDeal(ctx, dealId);
  revalidatePath(`/w/${workspace}/deals`);
  return { success: "Deal deleted" };
}
