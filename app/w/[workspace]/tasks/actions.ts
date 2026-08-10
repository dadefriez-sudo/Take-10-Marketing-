"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/tenant";
import { createTask, deleteTask, toggleTask } from "@/lib/repos/crm";

export interface TaskState {
  error?: string;
  success?: string;
}

const taskSchema = z.object({
  title: z.string().trim().min(1, "Describe the task").max(200),
  contactId: z.string().optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

export async function createTaskAction(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "task:write");

  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    contactId: String(formData.get("contactId") ?? "") || undefined,
    dueAt: String(formData.get("dueAt") ?? "") || undefined,
    priority: (formData.get("priority") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return { error: "That due date could not be read" };
  }

  const task = await createTask(ctx, {
    title: parsed.data.title,
    contactId: parsed.data.contactId ?? null,
    dueAt,
    priority: parsed.data.priority ?? "NORMAL",
  });

  if (!task) return { error: "That contact no longer exists" };

  revalidatePath(`/w/${workspace}/tasks`);
  return { success: "Task added" };
}

export async function toggleTaskAction(
  workspace: string,
  taskId: string,
  done: boolean,
): Promise<TaskState> {
  const ctx = await requirePermission(workspace, "task:write");
  const ok = await toggleTask(ctx, taskId, done);
  if (!ok) return { error: "That task no longer exists" };

  revalidatePath(`/w/${workspace}/tasks`);
  return { success: done ? "Marked done" : "Reopened" };
}

export async function deleteTaskAction(
  workspace: string,
  taskId: string,
): Promise<TaskState> {
  const ctx = await requirePermission(workspace, "task:write");
  await deleteTask(ctx, taskId);
  revalidatePath(`/w/${workspace}/tasks`);
  return { success: "Task deleted" };
}
