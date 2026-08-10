import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { listTasks } from "@/lib/repos/crm";
import { listContacts } from "@/lib/repos/contacts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, fullName } from "@/lib/utils";
import { TaskList } from "./task-list";
import { NewTaskForm } from "./new-task-form";

export const metadata = { title: "Tasks" };

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { workspace } = await params;
  const { show } = await searchParams;
  const ctx = await requireTenant(workspace);

  const showDone = show === "done";
  const [tasks, contacts] = await Promise.all([
    listTasks(ctx, { open: !showDone }),
    listContacts(ctx, { pageSize: 100, sort: "recent" }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Follow-ups for this client. From Phase 2, automations create these for you."
      />

      <NewTaskForm
        workspace={workspace}
        contacts={contacts.items.map((contact) => ({
          id: contact.id,
          name: fullName(contact),
        }))}
      />

      <div className="flex gap-2">
        <Link
          href={`/w/${workspace}/tasks`}
          className={`text-sm ${!showDone ? "font-medium" : "text-muted-foreground hover:underline"}`}
        >
          Open
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href={`/w/${workspace}/tasks?show=done`}
          className={`text-sm ${showDone ? "font-medium" : "text-muted-foreground hover:underline"}`}
        >
          Completed
        </Link>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title={showDone ? "Nothing completed yet" : "No open tasks"}
            description={
              showDone
                ? "Completed tasks will collect here."
                : "Add a follow-up above so nothing slips."
            }
          />
        </Card>
      ) : (
        <TaskList
          workspace={workspace}
          tasks={tasks.map((task) => ({
            id: task.id,
            title: task.title,
            priority: task.priority,
            dueLabel: task.dueAt
              ? formatDate(task.dueAt, ctx.workspace.timezone)
              : null,
            overdue: Boolean(
              task.dueAt && !task.completedAt && task.dueAt < new Date(),
            ),
            completed: Boolean(task.completedAt),
            contactId: task.contactId,
            contactName: task.contact ? fullName(task.contact) : null,
            assignee: task.assignee?.name ?? task.assignee?.email ?? null,
          }))}
        />
      )}
    </div>
  );
}
