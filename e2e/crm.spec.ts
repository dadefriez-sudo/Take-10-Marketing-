import { expect, test, type Page } from "@playwright/test";

/**
 * These run against the seeded demo data (`pnpm db:seed`).
 *
 * The tenancy tests matter most: a client login reaching another workspace, or
 * reaching the agency surface at all, is the failure that would end the
 * product, so it is asserted from the browser and not only at the query layer.
 */

const AGENCY = { email: "owner@take10.demo", password: "take10demo!" };
const CLIENT = { email: "client@brightsmile.demo", password: "take10demo!" };

const DENTAL = "bright-smile-dental";
const HVAC = "harbor-hvac";

async function signIn(
  page: Page,
  credentials: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/workspaces|\/w\/|\/portal\//);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/);
}

test.describe("agency user", () => {
  test("signs in and reaches a client workspace", async ({ page }) => {
    await signIn(page, AGENCY);

    await expect(page).toHaveURL(/\/workspaces/);
    await expect(page.getByText("Bright Smile Dental")).toBeVisible();

    await page.getByText("Bright Smile Dental").click();
    await page.waitForURL(new RegExp(`/w/${DENTAL}`));

    await expect(
      page.getByRole("heading", { name: "Bright Smile Dental" }),
    ).toBeVisible();
    await expect(page.getByText("Contacts", { exact: true }).first()).toBeVisible();
  });

  test("lists, searches, and filters contacts", async ({ page }) => {
    await signIn(page, AGENCY);
    await page.goto(`/w/${DENTAL}/contacts`);

    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const seeded = await rows.count();
    expect(seeded).toBeGreaterThan(0);

    // Filtering to a single status must narrow the set, never widen it, and
    // every row that comes back must actually carry that status.
    await page.goto(`/w/${DENTAL}/contacts?status=CUSTOMER`);

    const statusCells = page.locator("tbody tr td:nth-child(4)");
    await expect(statusCells.first()).toBeVisible();

    const filtered = await statusCells.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(seeded);

    for (const text of await statusCells.allInnerTexts()) {
      expect(text.trim()).toBe("CUSTOMER");
    }
  });

  test("creates a contact and logs a note on its timeline", async ({ page }) => {
    await signIn(page, AGENCY);
    await page.goto(`/w/${DENTAL}/contacts`);

    const unique = Date.now();
    const email = `e2e.contact.${unique}@example.test`;

    await page.getByRole("button", { name: "Add contact" }).first().click();
    await page.getByLabel("First name").fill("Playwright");
    await page.getByLabel("Last name").fill("Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Save contact" }).click();

    await page.goto(`/w/${DENTAL}/contacts?q=${encodeURIComponent(email)}`);
    await page.getByRole("link", { name: "Playwright Tester" }).click();

    await expect(
      page.getByRole("heading", { name: "Playwright Tester" }),
    ).toBeVisible();

    const note = `Called about a cleaning ${unique}`;
    await page.getByPlaceholder("Log a call").fill(note);
    await page.getByRole("button", { name: "Add note" }).click();

    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText("Note added").first()).toBeVisible();
  });

  test("renders the deals board with pipeline stages", async ({ page }) => {
    await signIn(page, AGENCY);
    await page.goto(`/w/${DENTAL}/deals`);

    await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
    for (const stage of ["New lead", "Contacted", "Won", "Lost"]) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
  });

  test("exports contacts as CSV scoped to the workspace", async ({ page }) => {
    await signIn(page, AGENCY);

    const response = await page.request.get(`/w/${DENTAL}/contacts/export`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const body = await response.text();
    expect(body.split("\n")[0]).toContain("email");
    // Seeded emails are namespaced per workspace; the HVAC namespace must not
    // appear in the dental export.
    expect(body).not.toContain("@harborhv.demo");
  });
});

test.describe("tenancy boundaries", () => {
  test("a client login lands on the portal, not the agency app", async ({
    page,
  }) => {
    await signIn(page, CLIENT);
    await expect(page).toHaveURL(new RegExp(`/portal/${DENTAL}`));
    await expect(
      page.getByRole("heading", { name: "Welcome, Bright Smile Dental" }),
    ).toBeVisible();
  });

  test("a client cannot open the agency surface for their own workspace", async ({
    page,
  }) => {
    await signIn(page, CLIENT);
    await page.goto(`/w/${DENTAL}`);
    await expect(page).toHaveURL(new RegExp(`/portal/${DENTAL}`));
  });

  test("a client cannot reach another client's workspace", async ({ page }) => {
    await signIn(page, CLIENT);

    await page.goto(`/w/${HVAC}`);
    await expect(page).not.toHaveURL(new RegExp(`/w/${HVAC}$`));

    await page.goto(`/portal/${HVAC}`);
    await expect(page).not.toHaveURL(new RegExp(`/portal/${HVAC}$`));
  });

  test("a client cannot export another workspace's contacts", async ({
    page,
  }) => {
    await signIn(page, CLIENT);

    const response = await page.request.get(`/w/${HVAC}/contacts/export`, {
      maxRedirects: 0,
    });
    // Either redirected away or refused — never 200 with another client's data.
    expect(response.status()).not.toBe(200);
  });

  test("signed-out visitors are sent to the login page", async ({ page }) => {
    await page.goto(`/w/${DENTAL}/contacts`);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("auth", () => {
  test("rejects a wrong password without revealing the account", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(AGENCY.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(
      page.getByText("That email and password combination did not match"),
    ).toBeVisible();
  });

  test("sign out ends the session", async ({ page }) => {
    await signIn(page, AGENCY);
    await signOut(page);

    await page.goto(`/w/${DENTAL}`);
    await expect(page).toHaveURL(/\/login/);
  });
});
