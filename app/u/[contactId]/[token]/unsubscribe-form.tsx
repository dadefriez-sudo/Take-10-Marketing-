"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  resubscribeAction,
  unsubscribeAction,
  type UnsubscribeState,
} from "./actions";

const EMPTY: UnsubscribeState = {};

export function UnsubscribeForm({
  contactId,
  token,
  alreadyUnsubscribed,
}: {
  contactId: string;
  token: string;
  alreadyUnsubscribed: boolean;
}) {
  const [offState, unsubscribe, offPending] = useActionState(
    unsubscribeAction,
    EMPTY,
  );
  const [onState, resubscribe, onPending] = useActionState(
    resubscribeAction,
    EMPTY,
  );

  const isOff = (alreadyUnsubscribed || offState.done) && !onState.resubscribed;
  const error = offState.error ?? onState.error;

  return (
    <div className="space-y-3">
      {isOff ? (
        <form action={resubscribe}>
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="token" value={token} />
          <p className="text-muted-foreground mb-3 text-sm">
            Changed your mind?
          </p>
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            disabled={onPending}
          >
            {onPending ? "Working…" : "Re-subscribe"}
          </Button>
        </form>
      ) : (
        <form action={unsubscribe}>
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="w-full" disabled={offPending}>
            {offPending ? "Working…" : "Unsubscribe me"}
          </Button>
        </form>
      )}

      {onState.resubscribed ? (
        <p className="text-muted-foreground text-sm" role="status">
          You&apos;re back on the list.
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
