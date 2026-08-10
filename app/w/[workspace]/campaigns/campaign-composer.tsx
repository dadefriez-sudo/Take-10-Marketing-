"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import {
  audienceSizeAction,
  createCampaignAction,
  type CampaignState,
} from "./actions";

const EMPTY: CampaignState = {};

export function CampaignComposer({
  workspace,
  segments,
}: {
  workspace: string;
  segments: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [segmentId, setSegmentId] = useState("");
  const [audience, setAudience] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Show who this reaches as soon as the segment changes — the question that
  // prevents the expensive mistakes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    audienceSizeAction(workspace, segmentId || null)
      .then((size) => {
        if (!cancelled) setAudience(size);
      })
      .catch(() => {
        if (!cancelled) setAudience(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, segmentId, open]);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New campaign
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New campaign</CardTitle>
        <CardDescription>
          Saved as a draft. Nothing sends until you press Send on the list
          below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={(formData) => {
            startTransition(async () => {
              const result = await createCampaignAction(EMPTY, formData);
              if (result.error) {
                setError(result.error);
                return;
              }
              setError(undefined);
              toast.success(result.success ?? "Draft created");
              setOpen(false);
              router.refresh();
            });
          }}
          className="space-y-3"
        >
          <input type="hidden" name="workspace" value={workspace} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign name">
              <Input name="name" required placeholder="August cleaning offer" />
            </Field>
            <Field
              label="Audience"
              hint={
                audience === null
                  ? "Counting…"
                  : `${audience.toLocaleString()} ${
                      audience === 1 ? "contact" : "contacts"
                    }`
              }
            >
              <Select
                name="segmentId"
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
              >
                <option value="">Everyone (excluding unsubscribed)</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Subject">
            <Input name="subject" required placeholder="A little something for August" />
          </Field>

          <Field
            label="Message (HTML)"
            hint="An unsubscribe link and your postal address are appended automatically."
          >
            <Textarea
              name="body"
              rows={6}
              required
              defaultValue="<p>Hi there,</p>\n<p>…</p>"
            />
          </Field>

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save draft"}
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
