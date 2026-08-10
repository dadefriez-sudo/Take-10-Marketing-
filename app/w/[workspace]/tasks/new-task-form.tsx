"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, Field, Input, Select } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { createTaskAction, type TaskState } from "./actions";

const EMPTY: TaskState = {};

export function NewTaskForm({
  workspace,
  contacts,
}: {
  workspace: string;
  contacts: Array<{ id: string; name: string }>;
}) {
  const [state, submit, pending] = useActionState(createTaskAction, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      formRef.current?.reset();
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <Card>
      <CardContent className="pt-5">
        <form
          ref={formRef}
          action={submit}
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
        >
          <input type="hidden" name="workspace" value={workspace} />

          <Field label="Task">
            <Input name="title" required placeholder="Call back about the quote" />
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
          <Field label="Due">
            <Input name="dueAt" type="date" />
          </Field>

          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>

          {state.error ? (
            <p className="text-destructive text-sm sm:col-span-4" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
