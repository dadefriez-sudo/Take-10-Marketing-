# Take 10 Marketing

An agency operating platform: run many client businesses from one place, with
their contacts, bookings, reviews, and after-hours call capture in a single
system instead of six SaaS subscriptions.

**Status: Phases 0–2 complete.** Multi-tenant foundation, CRM, and the
messaging + automation engine are built and tested. The phases that follow are
listed below.

---

## What works today

- **Multi-tenant by construction.** An organization (the agency) owns workspaces
  (one per client business). Every domain row carries a `workspaceId`, and every
  query goes through a repository that requires a `TenantContext` — there is no
  ambient scope to forget.
- **Two audiences.** Agency staff (`OWNER` / `ADMIN` / `MEMBER`) reach every
  client; a `CLIENT` login is pinned to one workspace and only ever sees the
  portal.
- **Auth.** Email + password, one-time email sign-in links, and invitations for
  staff and clients.
- **CRM.** Contacts with custom fields, tags, lists, saved segments, a full
  activity timeline, notes, tasks, CSV import with column mapping and dedupe,
  and CSV export.
- **Deals.** Drag-and-drop pipeline with per-stage value rollups.
- **Client portal.** A separate, simplified surface clients log into.
- **Messaging.** One outbound path for email and SMS with compliance enforced at
  the door: suppression, consent, quiet hours in the recipient's local time,
  CAN-SPAM footer, one-click unsubscribe, and SMS STOP/START/HELP.
- **Automations.** Versioned sequences with waits, if/else, A/B splits, and
  goals, driven by a durable Postgres job queue. Editing never strands contacts
  mid-sequence.
- **Campaigns.** One-off broadcasts to a saved segment, with the audience size
  shown before anything sends.
- **Unified inbox.** One thread per contact per channel, with replies.
- **Open and click tracking**, HMAC-signed so engagement numbers can't be forged.

## Getting started

Requirements: Node 22.12+, pnpm, and a Postgres database.

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
pnpm db:deploy                # apply migrations
pnpm db:seed                  # demo agency + 2 clients + 500 contacts
pnpm dev
```

Generate a secret with `openssl rand -base64 32`.

The seed prints its logins:

| Role | Email | Password | Lands on |
|---|---|---|---|
| Agency owner | `owner@take10.demo` | `take10demo!` | `/w/bright-smile-dental` |
| Client | `client@brightsmile.demo` | `take10demo!` | `/portal/bright-smile-dental` |

### No API keys needed

Every integration sits behind an adapter with a mock implementation, so the app
is fully usable before you have a single vendor account. With no email provider
configured, outbound mail — sign-in links, invitations — is captured at
**`/dev/inbox`** instead of being sent. Adding a real key later is a
configuration change, not a rewrite.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Generate Prisma client, then production build |
| `pnpm test` | Vitest — segment compiler + tenant isolation |
| `pnpm e2e` | Playwright — full browser flows |
| `pnpm typecheck` / `pnpm lint` | Types and lint |
| `pnpm db:migrate` | Create and apply a migration |
| `pnpm db:seed` | Reset and reload demo data |
| `pnpm db:studio` | Browse the database |

## Architecture

Next.js (App Router) · TypeScript · Postgres via Prisma 7 · Auth.js v5 ·
Tailwind v4 · Vitest + Playwright.

```
app/(auth)/**           sign-in, sign-up, magic link
app/w/[workspace]/**    agency surface
app/portal/[workspace]/ client surface
app/invite/[token]/     invitation acceptance
lib/tenant.ts           getTenantContext(), can(), audit log
lib/repos/*.ts          every query; TenantContext is a required argument
lib/segments/compile.ts predicate tree → Prisma where (CRM + future automations)
lib/providers/**        adapter seam for email/SMS/voice/calendar/reviews
prisma/schema.prisma    data model
```

Three decisions worth knowing:

- **Tenancy is enforced at the query builder, not the route.** `compileSegmentForWorkspace`
  always AND-s the workspace scope in, so even an OR-heavy user-authored filter
  cannot widen past the tenant. `lib/repos/tenant-isolation.test.ts` asserts this
  against a real database.
- **Segments compile to Prisma `where` objects, not SQL strings.** User-authored
  filter values stay parameterized; nothing is interpolated.
- **Phone numbers are stored E.164 or not at all.** A half-valid number that
  can't be matched later is worse than a null when Phase 5 starts routing calls.

## Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation: tenancy, auth, audit, shell | ✅ Done |
| 1 | CRM: contacts, segments, timeline, deals, tasks | ✅ Done |
| 2 | Messaging spine + automation engine (email/SMS) | ✅ Done |
| 3 | Booking: services, availability, calendar sync, reminders | Next |
| 4 | Google reviews: request automation, replies, monitoring | Planned |
| 5 | After-hours: missed-call text-back, IVR, unified inbox | Planned |
| 6 | Lead capture: forms and landing pages | Planned |
| 7 | Social scheduling with client approvals | Planned |
| 8 | Client reporting, white-label, portal polish | Planned |

### Compliance is built in, not bolted on

Phases 2–5 handle regulated channels, and the design assumes that from the
start: consent capture, one-click unsubscribe, SMS `STOP`/`HELP`, quiet hours in
the recipient's local time, and suppression enforced at send time.

**Google reviews are requested without gating.** Google prohibits screening for
happy customers and routing only them to the review link — doing it risks the
client's reviews being stripped and their listing penalized. Every customer gets
the same ask with the same link; a private feedback channel is offered alongside
it, never as a filter.

### External accounts you'll need

Not required to run the app; required to take each phase live.

- **Twilio + A2P/10DLC registration** — mandatory for US SMS, takes days to
  weeks, and needs each client's legal entity and EIN. Start it early.
- **Google Business Profile API access** — approval request to Google.
- **Meta / LinkedIn / TikTok app review** — for social publishing.
- Email sending domain and DNS, Stripe, and your own legal documents.

## Testing

```bash
pnpm test    # 149 tests: segment compiler + evaluator parity, compliance guard,
             # automation reducer, tracking, and DB-backed integration suites
pnpm e2e     # 17 browser flows, incl. client-cannot-reach-another-client and a
             # full automation run from publish to delivery
```

### The automation engine

`lib/automation/step.ts` is a pure reducer — it performs no I/O, so every node
kind, branch, and wait resumption is testable in milliseconds. `run.ts` loads
state, calls it, and writes back what came out. Graphs are versioned and
immutable once published, so editing an automation cannot strand a contact
partway through a sequence that no longer exists.

The same segment predicate language has two backends: `compile.ts` produces a
Prisma `where` for audience queries, and `evaluate.ts` evaluates in memory for
automation conditions. A parity suite runs identical predicates through both
against a real database — it exists because they *did* diverge once, on how
Postgres treats NULL in a negation.

`pnpm test` skips the isolation suite when `DATABASE_URL` is unset; CI always
provides one, so it always runs there.
