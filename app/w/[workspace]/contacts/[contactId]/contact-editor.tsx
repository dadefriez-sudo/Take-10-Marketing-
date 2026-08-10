"use client";

import { useActionState, useEffect } from "react";
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
import { updateContactAction, type FormState } from "../actions";

const EMPTY: FormState = {};

export function ContactEditor({
  workspace,
  contact,
}: {
  workspace: string;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    jobTitle: string | null;
    status: string;
    source: string | null;
  };
}) {
  const [state, submit, pending] = useActionState(updateContactAction, EMPTY);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-3">
          <input type="hidden" name="workspace" value={workspace} />
          <input type="hidden" name="contactId" value={contact.id} />

          <Field label="First name">
            <Input name="firstName" defaultValue={contact.firstName ?? ""} />
          </Field>
          <Field label="Last name">
            <Input name="lastName" defaultValue={contact.lastName ?? ""} />
          </Field>
          <Field label="Email">
            <Input
              name="email"
              type="email"
              defaultValue={contact.email ?? ""}
            />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={contact.phone ?? ""} />
          </Field>
          <Field label="Company">
            <Input name="company" defaultValue={contact.company ?? ""} />
          </Field>
          <Field label="Job title">
            <Input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={contact.status}>
              <option value="LEAD">Lead</option>
              <option value="ACTIVE">Active</option>
              <option value="CUSTOMER">Customer</option>
              <option value="UNSUBSCRIBED">Unsubscribed</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
          <Field label="Source">
            <Input name="source" defaultValue={contact.source ?? ""} />
          </Field>

          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
