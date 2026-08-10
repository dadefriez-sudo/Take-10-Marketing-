"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { consumeMagicLinkAction, type ActionState } from "./actions";

const EMPTY: ActionState = {};

export function MagicConsumer({ token }: { token: string }) {
  const [state, submit, pending] = useActionState(
    consumeMagicLinkAction,
    EMPTY,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    // One attempt only — the token is single-use, so a re-submit would fail.
    if (submitted.current) return;
    submitted.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {state.error ? "That link didn't work" : "Signing you in…"}
        </CardTitle>
        <CardDescription>
          {state.error ??
            "Hold on a moment while we verify your sign-in link."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form ref={formRef} action={submit}>
          <input type="hidden" name="token" value={token} />
          {state.error ? (
            <Button type="submit" variant="secondary" disabled={pending}>
              Try again
            </Button>
          ) : null}
        </form>

        {state.error ? (
          <Button asChild className="w-full">
            <Link href="/login">Request a new link</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
