"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, writeAuditLog } from "@/lib/tenant";
import {
  createContact,
  deleteContacts,
  setContactLists,
  setContactTags,
  updateContact,
} from "@/lib/repos/contacts";
import {
  addNote,
  createTag,
  createList,
  deleteSegment,
  saveSegment,
} from "@/lib/repos/crm";
import type { SegmentGroup } from "@/lib/segments/types";
import { parseSegmentDefinition } from "@/lib/segments/compile";

export interface FormState {
  error?: string;
  success?: string;
}

const CONTACT_STATUSES = [
  "LEAD",
  "ACTIVE",
  "CUSTOMER",
  "UNSUBSCRIBED",
  "ARCHIVED",
] as const;

const contactSchema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  source: z.string().trim().max(80).optional(),
});

function readContact(formData: FormData) {
  return contactSchema.safeParse({
    firstName: formData.get("firstName") ?? undefined,
    lastName: formData.get("lastName") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    company: formData.get("company") ?? undefined,
    jobTitle: formData.get("jobTitle") ?? undefined,
    status: (formData.get("status") as string) || undefined,
    source: formData.get("source") ?? undefined,
  });
}

export async function createContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "contact:write");

  const parsed = readContact(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  if (!parsed.data.email && !parsed.data.phone) {
    // Without one of these the contact can never be reached by any later
    // phase, and cannot be deduplicated on import.
    return { error: "Enter an email address or a phone number" };
  }

  try {
    const contact = await createContact(ctx, parsed.data);
    await writeAuditLog(ctx, "contact.created", {
      targetType: "Contact",
      targetId: contact.id,
    });
  } catch {
    return { error: "A contact with that email or phone already exists" };
  }

  revalidatePath(`/w/${workspace}/contacts`);
  return { success: "Contact added" };
}

export async function updateContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspace = String(formData.get("workspace") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const ctx = await requirePermission(workspace, "contact:write");

  const parsed = readContact(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  try {
    const updated = await updateContact(ctx, contactId, parsed.data);
    if (!updated) return { error: "That contact no longer exists" };
    await writeAuditLog(ctx, "contact.updated", {
      targetType: "Contact",
      targetId: contactId,
    });
  } catch {
    return { error: "Another contact already uses that email or phone" };
  }

  revalidatePath(`/w/${workspace}/contacts/${contactId}`);
  return { success: "Saved" };
}

export async function deleteContactsAction(
  workspace: string,
  contactIds: string[],
): Promise<FormState> {
  const ctx = await requirePermission(workspace, "contact:delete");
  const count = await deleteContacts(ctx, contactIds);
  await writeAuditLog(ctx, "contact.deleted", {
    metadata: { count, contactIds },
  });
  revalidatePath(`/w/${workspace}/contacts`);
  return { success: `Deleted ${count} contact${count === 1 ? "" : "s"}` };
}

export async function bulkTagAction(
  workspace: string,
  contactIds: string[],
  tagIds: string[],
  mode: "add" | "remove",
): Promise<FormState> {
  const ctx = await requirePermission(workspace, "contact:write");
  const count = await setContactTags(ctx, contactIds, tagIds, mode);
  revalidatePath(`/w/${workspace}/contacts`);
  return {
    success: `${mode === "add" ? "Tagged" : "Untagged"} ${count} contact${
      count === 1 ? "" : "s"
    }`,
  };
}

export async function bulkListAction(
  workspace: string,
  contactIds: string[],
  listIds: string[],
  mode: "add" | "remove",
): Promise<FormState> {
  const ctx = await requirePermission(workspace, "contact:write");
  const count = await setContactLists(ctx, contactIds, listIds, mode);
  revalidatePath(`/w/${workspace}/contacts`);
  return { success: `Updated ${count} contact${count === 1 ? "" : "s"}` };
}

export async function createTagAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspace = String(formData.get("workspace") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a tag name" };

  const ctx = await requirePermission(workspace, "contact:write");
  await createTag(ctx, name, String(formData.get("color") ?? "") || undefined);

  revalidatePath(`/w/${workspace}/contacts`);
  return { success: `Created "${name}"` };
}

export async function createListAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspace = String(formData.get("workspace") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a list name" };

  const ctx = await requirePermission(workspace, "contact:write");
  await createList(ctx, name);

  revalidatePath(`/w/${workspace}/contacts`);
  return { success: `Created "${name}"` };
}

export async function addNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspace = String(formData.get("workspace") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Write something first" };

  const ctx = await requirePermission(workspace, "contact:write");
  const note = await addNote(ctx, contactId, body);
  if (!note) return { error: "That contact no longer exists" };

  revalidatePath(`/w/${workspace}/contacts/${contactId}`);
  return { success: "Note added" };
}

export async function saveSegmentAction(
  workspace: string,
  input: { id?: string; name: string; definition: SegmentGroup },
): Promise<FormState> {
  const ctx = await requirePermission(workspace, "segment:write");

  try {
    parseSegmentDefinition(input.definition);
  } catch {
    return { error: "That filter could not be saved" };
  }

  const saved = await saveSegment(ctx, input);
  if (!saved) return { error: "That segment no longer exists" };

  revalidatePath(`/w/${workspace}/contacts`);
  return { success: `Saved "${saved.name}"` };
}

export async function deleteSegmentAction(
  workspace: string,
  segmentId: string,
): Promise<FormState> {
  const ctx = await requirePermission(workspace, "segment:write");
  await deleteSegment(ctx, segmentId);
  revalidatePath(`/w/${workspace}/contacts`);
  return { success: "Segment deleted" };
}
