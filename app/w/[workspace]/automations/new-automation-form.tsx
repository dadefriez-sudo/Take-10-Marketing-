"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, Input } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { createAutomationAction, type AutomationState } from "./actions";

const EMPTY: AutomationState = {};

export function NewAutomationForm({ workspace }: { workspace: string }) {
  const [state, submit, pending] = useActionState(
    createAutomationAction,
    EMPTY,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      formRef.current?.reset();
      router.refresh();
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <Card>
      <CardContent className="pt-5">
        <form ref={formRef} action={submit} className="flex flex-wrap gap-3">
          <input type="hidden" name="workspace" value={workspace} />
          <Input
            name="name"
            required
            placeholder="New patient welcome"
            className="max-w-sm"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "New automation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
