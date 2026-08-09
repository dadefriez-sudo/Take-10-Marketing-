"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import {
  createListAction,
  createTagAction,
  createWorkspaceAction,
  inviteMemberAction,
  updateWorkspaceAction,
  type SettingsState,
} from "./actions";

const EMPTY: SettingsState = {};

function useToastedAction(
  action: (
    state: SettingsState,
    formData: FormData,
  ) => Promise<SettingsState>,
) {
  const [state, submit, pending] = useActionState(action, EMPTY);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      router.refresh();
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  return { state, submit, pending };
}

export function SettingsForms({
  workspace,
  canManage,
  canInvite,
  current,
  tags,
  lists,
  invitations,
}: {
  workspace: string;
  canManage: boolean;
  canInvite: boolean;
  current: {
    name: string;
    timezone: string;
    industry: string;
    websiteUrl: string;
    phone: string;
  };
  tags: Array<{ id: string; name: string; color: string; count: number }>;
  lists: Array<{ id: string; name: string; count: number }>;
  invitations: Array<{
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  }>;
}) {
  const workspaceForm = useToastedAction(updateWorkspaceAction);
  const newWorkspace = useToastedAction(createWorkspaceAction);
  const invite = useToastedAction(inviteMemberAction);
  const tagForm = useToastedAction(createTagAction);
  const listForm = useToastedAction(createListAction);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
          <CardDescription>
            The time zone drives booking availability and messaging quiet hours
            in later phases — set it to the business&apos;s local zone, not
            yours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={workspaceForm.submit} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="workspace" value={workspace} />
            <Field label="Business name">
              <Input name="name" defaultValue={current.name} disabled={!canManage} required />
            </Field>
            <Field label="Time zone" hint="IANA name, e.g. America/Chicago">
              <Input
                name="timezone"
                defaultValue={current.timezone}
                disabled={!canManage}
                required
              />
            </Field>
            <Field label="Industry">
              <Input
                name="industry"
                defaultValue={current.industry}
                disabled={!canManage}
                placeholder="Dental, HVAC, salon…"
              />
            </Field>
            <Field label="Website">
              <Input
                name="websiteUrl"
                defaultValue={current.websiteUrl}
                disabled={!canManage}
              />
            </Field>
            <Field label="Business phone">
              <Input name="phone" defaultValue={current.phone} disabled={!canManage} />
            </Field>
            {canManage ? (
              <div className="flex items-end">
                <Button type="submit" disabled={workspaceForm.pending}>
                  {workspaceForm.pending ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a client</CardTitle>
            <CardDescription>
              Each client gets its own isolated workspace, pipeline, and contact
              database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={newWorkspace.submit} className="flex flex-wrap gap-3">
              <input type="hidden" name="workspace" value={workspace} />
              <Input
                name="name"
                required
                placeholder="Bright Smile Dental"
                className="max-w-xs"
              />
              <Button type="submit" disabled={newWorkspace.pending}>
                {newWorkspace.pending ? "Creating…" : "Create client"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>
              Admins and members work across every client. A client login is
              locked to {current.name} alone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={invite.submit} className="flex flex-wrap gap-3">
              <input type="hidden" name="workspace" value={workspace} />
              <Input
                name="email"
                type="email"
                required
                placeholder="person@example.com"
                className="max-w-xs"
              />
              <Select name="role" defaultValue="MEMBER" className="w-40">
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
                <option value="CLIENT">Client (this workspace)</option>
              </Select>
              <Button type="submit" disabled={invite.pending}>
                {invite.pending ? "Sending…" : "Send invite"}
              </Button>
            </form>

            {invitations.length > 0 ? (
              <ul className="divide-border divide-y text-sm">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="truncate">{invitation.email}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{invitation.role}</Badge>
                      <span className="text-muted-foreground text-xs">
                        expires {invitation.expiresAt}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
            <CardDescription>
              Used for segmenting and, from Phase 2, for automation triggers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={tagForm.submit} className="flex gap-2">
              <input type="hidden" name="workspace" value={workspace} />
              <Input name="name" placeholder="New tag" required />
              <Input
                name="color"
                type="color"
                defaultValue="#6366f1"
                className="w-14 p-1"
                aria-label="Tag colour"
              />
              <Button type="submit" disabled={tagForm.pending}>
                Add
              </Button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag.id} variant="outline">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <span className="text-muted-foreground">{tag.count}</span>
                </Badge>
              ))}
              {tags.length === 0 ? (
                <p className="text-muted-foreground text-sm">No tags yet.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lists</CardTitle>
            <CardDescription>
              Explicit membership, as opposed to a segment&apos;s live filter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={listForm.submit} className="flex gap-2">
              <input type="hidden" name="workspace" value={workspace} />
              <Input name="name" placeholder="New list" required />
              <Button type="submit" disabled={listForm.pending}>
                Add
              </Button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {lists.map((list) => (
                <Badge key={list.id} variant="outline">
                  ☰ {list.name}
                  <span className="text-muted-foreground">{list.count}</span>
                </Badge>
              ))}
              {lists.length === 0 ? (
                <p className="text-muted-foreground text-sm">No lists yet.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
