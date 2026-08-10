"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, writeAuditLog } from "@/lib/tenant";
import {
  createAutomation,
  publishAutomation,
  saveDraftGraph,
  setAutomationStatus,
} from "@/lib/repos/automations";
import { enrollContact } from "@/lib/automation/run";
import type { AutomationGraph } from "@/lib/automation/graph";
import type { GraphProblem } from "@/lib/automation/graph";

export interface AutomationState {
  error?: string;
  success?: string;
  problems?: GraphProblem[];
}

export async function createAutomationAction(
  _prev: AutomationState,
  formData: FormData,
): Promise<AutomationState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "segment:write");

  const parsed = z
    .string()
    .trim()
    .min(1, "Name the automation")
    .max(120)
    .safeParse(formData.get("name"));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the name" };
  }

  try {
    const automation = await createAutomation(ctx, parsed.data);
    await writeAuditLog(ctx, "automation.created", {
      targetType: "Automation",
      targetId: automation.id,
    });
  } catch {
    return { error: "An automation with that name already exists" };
  }

  revalidatePath(`/w/${workspace}/automations`);
  return { success: "Automation created" };
}

export async function saveGraphAction(
  workspace: string,
  automationId: string,
  graph: AutomationGraph,
): Promise<AutomationState> {
  const ctx = await requirePermission(workspace, "segment:write");
  const result = await saveDraftGraph(ctx, automationId, graph);

  if (!result.ok) {
    return { error: "Could not save", problems: result.problems };
  }

  revalidatePath(`/w/${workspace}/automations/${automationId}`);
  return { success: "Draft saved" };
}

export async function publishAction(
  workspace: string,
  automationId: string,
): Promise<AutomationState> {
  const ctx = await requirePermission(workspace, "segment:write");
  const result = await publishAutomation(ctx, automationId);

  if (!result.ok) {
    return {
      error: "This automation can't go live yet",
      problems: result.problems,
    };
  }

  await writeAuditLog(ctx, "automation.published", {
    targetType: "Automation",
    targetId: automationId,
  });

  revalidatePath(`/w/${workspace}/automations`);
  revalidatePath(`/w/${workspace}/automations/${automationId}`);
  return { success: "Live — new contacts will start entering it" };
}

export async function setStatusAction(
  workspace: string,
  automationId: string,
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
): Promise<AutomationState> {
  const ctx = await requirePermission(workspace, "segment:write");
  const ok = await setAutomationStatus(ctx, automationId, status);
  if (!ok) return { error: "That automation no longer exists" };

  revalidatePath(`/w/${workspace}/automations`);
  revalidatePath(`/w/${workspace}/automations/${automationId}`);

  return {
    success:
      status === "PAUSED"
        ? "Paused — runs in flight stay where they are"
        : status === "ACTIVE"
          ? "Resumed"
          : "Archived",
  };
}

/** Drop a single contact into an automation, for testing a sequence. */
export async function enrollContactAction(
  workspace: string,
  automationId: string,
  contactId: string,
): Promise<AutomationState> {
  const ctx = await requirePermission(workspace, "segment:write");

  const contact = await (
    await import("@/lib/db")
  ).db.contact.findFirst({
    where: { id: contactId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contact) return { error: "That contact is not in this workspace" };

  const runId = await enrollContact(automationId, contactId);

  revalidatePath(`/w/${workspace}/automations/${automationId}`);

  if (!runId) {
    return {
      error:
        "Not enrolled — the automation may be inactive, or this contact has been through it already",
    };
  }

  return { success: "Enrolled. Run the worker to advance it." };
}
