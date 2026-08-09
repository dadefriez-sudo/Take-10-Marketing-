"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { runImportAction } from "./actions";
import {
  IMPORT_ROW_LIMIT,
  type ImportField,
  type ImportResult,
} from "./constants";

const FIELD_OPTIONS: Array<{ value: ImportField; label: string }> = [
  { value: "skip", label: "Don't import" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
];

/** Best-effort column guess so a normal export needs no manual mapping. */
function guessField(header: string): ImportField {
  const key = header.toLowerCase().replace(/[^a-z]/g, "");
  if (key.includes("email") || key === "mail") return "email";
  if (key.includes("phone") || key.includes("mobile") || key.includes("cell"))
    return "phone";
  if (key === "firstname" || key === "fname" || key === "given")
    return "firstName";
  if (key === "lastname" || key === "lname" || key === "surname")
    return "lastName";
  if (key === "name" || key === "fullname") return "firstName";
  if (key.includes("company") || key.includes("organization"))
    return "company";
  if (key.includes("title") || key.includes("role")) return "jobTitle";
  return "skip";
}

export function ImportWizard({
  workspace,
  tags,
  lists,
}: {
  workspace: string;
  tags: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string }>;
}) {
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportField>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File) {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(parsed) {
        const fields = parsed.meta.fields ?? [];
        if (fields.length === 0) {
          toast.error("That file has no header row.");
          return;
        }
        setHeaders(fields);
        setRows(parsed.data);
        setMapping(
          Object.fromEntries(fields.map((field) => [field, guessField(field)])),
        );
        if (parsed.errors.length > 0) {
          toast.warning(
            `${parsed.errors.length} row(s) had parsing problems and may import incompletely.`,
          );
        }
      },
      error() {
        toast.error("That file could not be read as CSV.");
      },
    });
  }

  function submit() {
    startTransition(async () => {
      const outcome = await runImportAction({
        workspace,
        rows,
        mapping,
        tagIds,
        listIds,
      });
      setResult(outcome);
      if (outcome.error) toast.error(outcome.error);
      else if (outcome.summary) {
        toast.success(
          `Imported ${outcome.summary.created} new, updated ${outcome.summary.updated}`,
        );
      }
    });
  }

  const preview = rows.slice(0, 5);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a file</CardTitle>
          <CardDescription>
            CSV with a header row, up to {IMPORT_ROW_LIMIT.toLocaleString()}{" "}
            rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </CardContent>
      </Card>

      {headers.length > 0 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Map the columns</CardTitle>
              <CardDescription>
                {rows.length.toLocaleString()} rows found. Map at least one
                column to Email or Phone — rows without either are skipped,
                because a contact with no way to reach them can&apos;t be
                deduplicated or messaged later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {headers.map((header) => (
                <div
                  key={header}
                  className="flex flex-wrap items-center gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium">{header}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {preview
                        .map((row) => row[header])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <Select
                    className="w-44"
                    value={mapping[header] ?? "skip"}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [header]: event.target.value as ImportField,
                      }))
                    }
                  >
                    {FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Tag what comes in</CardTitle>
              <CardDescription>
                Optional, but it makes the batch easy to find and segment later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {tags.length > 0 ? (
                <Field label="Apply tags">
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setTagIds((current) =>
                            current.includes(tag.id)
                              ? current.filter((id) => id !== tag.id)
                              : [...current, tag.id],
                          )
                        }
                      >
                        <Badge
                          variant={
                            tagIds.includes(tag.id) ? "default" : "outline"
                          }
                          className="cursor-pointer"
                        >
                          {tag.name}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </Field>
              ) : null}

              {lists.length > 0 ? (
                <Field label="Add to lists">
                  <div className="flex flex-wrap gap-1.5">
                    {lists.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() =>
                          setListIds((current) =>
                            current.includes(list.id)
                              ? current.filter((id) => id !== list.id)
                              : [...current, list.id],
                          )
                        }
                      >
                        <Badge
                          variant={
                            listIds.includes(list.id) ? "default" : "outline"
                          }
                          className="cursor-pointer"
                        >
                          {list.name}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </Field>
              ) : null}

              <Button onClick={submit} disabled={pending}>
                {pending
                  ? "Importing…"
                  : `Import ${rows.length.toLocaleString()} rows`}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}

      {result?.summary ? (
        <Card>
          <CardHeader>
            <CardTitle>Import complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>
                <strong className="tabular-nums">
                  {result.summary.created}
                </strong>{" "}
                created
              </span>
              <span>
                <strong className="tabular-nums">
                  {result.summary.updated}
                </strong>{" "}
                updated
              </span>
              <span>
                <strong className="tabular-nums">
                  {result.summary.skipped}
                </strong>{" "}
                skipped
              </span>
            </div>

            {result.summary.errors.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium">First problems</p>
                <ul className="text-muted-foreground list-inside list-disc">
                  {result.summary.errors.slice(0, 10).map((error) => (
                    <li key={error.row}>
                      Row {error.row}: {error.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
