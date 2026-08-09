"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, Textarea } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { addNoteAction, type FormState } from "../actions";

const EMPTY: FormState = {};

export function NoteComposer({
  workspace,
  contactId,
}: {
  workspace: string;
  contactId: string;
}) {
  const [state, submit, pending] = useActionState(addNoteAction, EMPTY);
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
        <form ref={formRef} action={submit} className="space-y-3">
          <input type="hidden" name="workspace" value={workspace} />
          <input type="hidden" name="contactId" value={contactId} />
          <Textarea
            name="body"
            placeholder="Log a call, a conversation, or anything the team should know…"
            required
          />
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
