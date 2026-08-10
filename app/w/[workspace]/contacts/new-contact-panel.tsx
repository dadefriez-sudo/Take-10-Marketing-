"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { createContactAction, type FormState } from "./actions";

const EMPTY: FormState = {};

export function NewContactPanel({
  workspace,
  open: initialOpen,
}: {
  workspace: string;
  open: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="secondary">
        Add contact
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New contact</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          // Handled in the submit callback rather than a useActionState effect:
          // closing the panel is a state update, and doing that from an effect
          // triggers a cascading render.
          action={(formData) => {
            startTransition(async () => {
              const result = await createContactAction(EMPTY, formData);
              if (result.error) {
                setError(result.error);
                return;
              }
              setError(undefined);
              toast.success(result.success ?? "Contact added");
              setOpen(false);
              router.refresh();
            });
          }}
          className="space-y-4"
        >
          <input type="hidden" name="workspace" value={workspace} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <Input name="firstName" autoComplete="off" />
            </Field>
            <Field label="Last name">
              <Input name="lastName" autoComplete="off" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" autoComplete="off" />
            </Field>
            <Field
              label="Phone"
              hint="Stored as E.164 so SMS and calls match later."
            >
              <Input
                name="phone"
                autoComplete="off"
                placeholder="(555) 010-2030"
              />
            </Field>
            <Field label="Company">
              <Input name="company" autoComplete="off" />
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue="LEAD">
                <option value="LEAD">Lead</option>
                <option value="ACTIVE">Active</option>
                <option value="CUSTOMER">Customer</option>
              </Select>
            </Field>
          </div>

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save contact"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
