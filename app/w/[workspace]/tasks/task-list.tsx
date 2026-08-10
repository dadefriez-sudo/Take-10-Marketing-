"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { deleteTaskAction, toggleTaskAction } from "./actions";
import { cn } from "@/lib/utils";

interface TaskRow {
  id: string;
  title: string;
  priority: string;
  dueLabel: string | null;
  overdue: boolean;
  completed: boolean;
  contactId: string | null;
  contactName: string | null;
  assignee: string | null;
}

export function TaskList({
  workspace,
  tasks,
}: {
  workspace: string;
  tasks: TaskRow[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  return (
    <Card className="divide-border divide-y overflow-hidden">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center gap-3 px-4 py-3"
        >
          <input
            type="checkbox"
            checked={task.completed}
            disabled={pending}
            aria-label={`Mark "${task.title}" ${task.completed ? "open" : "done"}`}
            onChange={() =>
              run(() => toggleTaskAction(workspace, task.id, !task.completed))
            }
            className="size-4 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm",
                task.completed && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </p>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              {task.contactId ? (
                <Link
                  href={`/w/${workspace}/contacts/${task.contactId}`}
                  className="hover:text-foreground hover:underline"
                >
                  {task.contactName}
                </Link>
              ) : null}
              {task.assignee ? <span>{task.assignee}</span> : null}
              {task.dueLabel ? (
                <span className={cn(task.overdue && "text-destructive font-medium")}>
                  {task.overdue ? "Overdue · " : "Due "}
                  {task.dueLabel}
                </span>
              ) : null}
            </div>
          </div>

          {task.priority !== "NORMAL" ? (
            <Badge
              variant={
                task.priority === "URGENT" || task.priority === "HIGH"
                  ? "warning"
                  : "outline"
              }
            >
              {task.priority}
            </Badge>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => deleteTaskAction(workspace, task.id))}
          >
            Delete
          </Button>
        </div>
      ))}
    </Card>
  );
}
