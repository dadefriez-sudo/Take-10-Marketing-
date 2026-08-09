/**
 * Demo data: one agency, two client businesses, ~500 contacts with realistic
 * spread, tags, lists, segments, deals, tasks, and activity.
 *
 * The point is that a fresh checkout lands on a CRM that looks used, so the
 * filters, pagination, and pipeline can actually be judged.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import type { ContactStatus } from "../generated/prisma/enums.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_PASSWORD = "take10demo!";

const FIRST = [
  "Ava","Liam","Maya","Noah","Sofia","Ethan","Isla","Mason","Chloe","Lucas",
  "Riley","Owen","Nora","Caleb","Elena","Jonah","Priya","Marcus","Tessa","Dev",
  "Grace","Andre","Leah","Victor","Naomi","Felix","Iris","Omar","Ruby","Jonas",
];
const LAST = [
  "Alvarez","Brennan","Cho","Duval","Ellis","Farrow","Gupta","Hollis","Iqbal",
  "Jensen","Kowalski","Lindqvist","Moreau","Nakamura","Okafor","Petrov",
  "Quintero","Rossi","Sandoval","Thibault","Ueda","Vasquez","Whitfield","Yara",
];
const COMPANIES = [
  "Northside Auto","Bright Smile Dental","Cedar & Co Salon","Harbor HVAC",
  "Lakeview Physio","Sunset Roofing","Copper Kettle Cafe","Ridgeline Fitness",
  "Bayside Veterinary","Ironwood Landscaping",
];
const SOURCES = [
  "google-search","facebook-ad","referral","walk-in","website-form",
  "missed-call","instagram","yelp",
];

/** Deterministic PRNG so reseeding produces the same demo data. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const random = makeRandom(20260809);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

async function main() {
  console.log("Seeding Take 10 Marketing demo data…");

  // Idempotent: wipe the demo org so reseeding doesn't stack duplicates.
  await db.organization.deleteMany({ where: { slug: "take-10-marketing" } });
  await db.user.deleteMany({
    where: { email: { in: ["owner@take10.demo", "client@brightsmile.demo"] } },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const owner = await db.user.create({
    data: {
      email: "owner@take10.demo",
      name: "Alex Rivera",
      passwordHash,
      emailVerified: new Date(),
    },
  });

  const clientUser = await db.user.create({
    data: {
      email: "client@brightsmile.demo",
      name: "Dr. Dana Brightwell",
      passwordHash,
      emailVerified: new Date(),
    },
  });

  const organization = await db.organization.create({
    data: {
      name: "Take 10 Marketing",
      slug: "take-10-marketing",
      senderName: "Take 10 Marketing",
      senderEmail: "hello@take10.example",
    },
  });

  await db.membership.create({
    data: {
      userId: owner.id,
      organizationId: organization.id,
      role: "OWNER",
    },
  });

  const dental = await db.workspace.create({
    data: {
      organizationId: organization.id,
      name: "Bright Smile Dental",
      slug: "bright-smile-dental",
      timezone: "America/Chicago",
      industry: "Dental",
      phone: "+15125550142",
      city: "Austin",
      region: "TX",
    },
  });

  const hvac = await db.workspace.create({
    data: {
      organizationId: organization.id,
      name: "Harbor HVAC",
      slug: "harbor-hvac",
      timezone: "America/New_York",
      industry: "HVAC",
      phone: "+16175550188",
      city: "Boston",
      region: "MA",
    },
  });

  // The client login reaches exactly one workspace.
  await db.membership.create({
    data: {
      userId: clientUser.id,
      organizationId: organization.id,
      workspaceId: dental.id,
      role: "CLIENT",
    },
  });

  for (const workspace of [dental, hvac]) {
    await seedWorkspace(workspace.id, workspace.name, owner.id);
  }

  console.log(`
Seed complete.

  Agency login   owner@take10.demo        / ${DEMO_PASSWORD}
  Client login   client@brightsmile.demo  / ${DEMO_PASSWORD}

  Agency view    /w/bright-smile-dental
  Client portal  /portal/bright-smile-dental
`);
}

async function seedWorkspace(
  workspaceId: string,
  workspaceName: string,
  ownerUserId: string,
) {
  const tagNames = [
    ["New patient", "#6366f1"],
    ["Repeat customer", "#10b981"],
    ["High value", "#f59e0b"],
    ["Needs follow-up", "#ef4444"],
    ["Left a review", "#8b5cf6"],
  ] as const;

  const tags = [];
  for (const [name, color] of tagNames) {
    tags.push(
      await db.tag.create({ data: { workspaceId, name, color } }),
    );
  }

  const lists = [];
  for (const name of ["Newsletter", "Appointment reminders", "Win-back"]) {
    lists.push(await db.list.create({ data: { workspaceId, name } }));
  }

  const lifetimeValue = await db.customField.create({
    data: {
      workspaceId,
      key: "lifetime_value",
      label: "Lifetime value",
      type: "NUMBER",
      position: 1,
    },
  });

  await db.segment.createMany({
    data: [
      {
        workspaceId,
        name: "Customers, last 90 days",
        description: "Active customers with recent activity",
        definition: {
          combinator: "AND",
          rules: [
            { field: "status", operator: "equals", value: "CUSTOMER" },
            { field: "lastActivityAt", operator: "within_days", value: 90 },
          ],
        },
      },
      {
        workspaceId,
        name: "Gone quiet",
        description: "No activity in 120 days — win-back candidates",
        definition: {
          combinator: "AND",
          rules: [
            {
              field: "lastActivityAt",
              operator: "more_than_days_ago",
              value: 120,
            },
            { field: "status", operator: "not_equals", value: "UNSUBSCRIBED" },
          ],
        },
      },
      {
        workspaceId,
        name: "Reachable by SMS",
        description: "Has a phone number on file",
        definition: {
          combinator: "AND",
          rules: [{ field: "phone", operator: "is_set" }],
        },
      },
    ],
  });

  const pipeline = await db.pipeline.create({
    data: {
      workspaceId,
      name: "Sales pipeline",
      isDefault: true,
      stages: {
        create: [
          { name: "New lead", position: 1, probability: 10 },
          { name: "Contacted", position: 2, probability: 25 },
          { name: "Proposal sent", position: 3, probability: 50 },
          { name: "Negotiation", position: 4, probability: 75 },
          { name: "Won", position: 5, probability: 100, isWon: true },
          { name: "Lost", position: 6, probability: 0, isLost: true },
        ],
      },
    },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  const statuses: ContactStatus[] = [
    "LEAD",
    "LEAD",
    "ACTIVE",
    "CUSTOMER",
    "CUSTOMER",
    "UNSUBSCRIBED",
  ];

  const slug = workspaceName.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  const contactIds: string[] = [];

  for (let index = 0; index < 250; index += 1) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const createdDays = Math.floor(random() * 400);
    const activityDays = Math.floor(random() * createdDays);
    const status = pick(statuses);

    const contact = await db.contact.create({
      data: {
        workspaceId,
        // Unique per workspace and obviously fake, so nobody emails a stranger.
        email: `${first.toLowerCase()}.${last.toLowerCase()}${index}@${slug}.demo`,
        phone:
          random() > 0.25
            ? `+1512${String(5_550_000 + index).slice(0, 7)}`
            : null,
        firstName: first,
        lastName: last,
        company: random() > 0.6 ? pick(COMPANIES) : null,
        status,
        source: pick(SOURCES),
        createdAt: daysAgo(createdDays),
        lastActivityAt: random() > 0.15 ? daysAgo(activityDays) : null,
      },
    });
    contactIds.push(contact.id);

    if (random() > 0.45) {
      await db.contactTag.create({
        data: { contactId: contact.id, tagId: pick(tags).id },
      });
    }
    if (random() > 0.6) {
      await db.contactList.create({
        data: { contactId: contact.id, listId: pick(lists).id },
      });
    }
    if (status === "CUSTOMER") {
      await db.contactFieldValue.create({
        data: {
          contactId: contact.id,
          fieldId: lifetimeValue.id,
          value: Math.floor(random() * 8000) + 200,
        },
      });
    }

    await db.activity.create({
      data: {
        workspaceId,
        contactId: contact.id,
        type: "SYSTEM",
        title: `Contact created from ${contact.source}`,
        occurredAt: contact.createdAt,
      },
    });

    if (contact.lastActivityAt) {
      await db.activity.create({
        data: {
          workspaceId,
          contactId: contact.id,
          type: random() > 0.5 ? "CALL" : "EMAIL",
          title:
            random() > 0.5
              ? "Inbound call — asked about availability"
              : "Sent follow-up about their quote",
          occurredAt: contact.lastActivityAt,
        },
      });
    }
  }

  const openStages = pipeline.stages.filter(
    (stage) => !stage.isWon && !stage.isLost,
  );

  for (let index = 0; index < 18; index += 1) {
    const stage = pick([...openStages, ...pipeline.stages.slice(4)]);
    await db.deal.create({
      data: {
        workspaceId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: pick(contactIds),
        ownerUserId,
        title: `${pick(["Retainer", "Package", "Install", "Treatment plan", "Service contract"])} — ${pick(LAST)}`,
        value: Math.floor(random() * 9000) + 500,
        status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        closedAt: stage.isWon || stage.isLost ? daysAgo(10) : null,
        position: (index + 1) * 1000,
        expectedCloseAt: daysAgo(-Math.floor(random() * 45)),
      },
    });
  }

  for (const title of [
    "Call back about the quote",
    "Send the treatment plan",
    "Confirm next week's appointments",
    "Chase the outstanding invoice",
    "Follow up on the missed call",
  ]) {
    await db.task.create({
      data: {
        workspaceId,
        title,
        contactId: pick(contactIds),
        assigneeUserId: ownerUserId,
        dueAt: daysAgo(-Math.floor(random() * 10) + 2),
        priority: random() > 0.7 ? "HIGH" : "NORMAL",
      },
    });
  }

  console.log(`  · ${workspaceName}: 250 contacts, 18 deals, 5 tasks`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
