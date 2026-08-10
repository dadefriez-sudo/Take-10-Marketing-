import { expect, test, type Page } from "@playwright/test";

/**
 * Drives the Phase 2 surfaces through the browser: building an automation,
 * publishing it, enrolling a contact, and driving the real cron heartbeat until
 * the sequence delivers.
 *
 * Deliberately avoids /api/dev/tick and /dev/inbox — both correctly 404 in a
 * production build, so exercising them here would test a path real deployments
 * never take.
 *
 * Also covers the unsubscribe page, because a broken opt-out is a compliance
 * failure rather than a cosmetic bug.
 */

const AGENCY = { email: "owner@take10.demo", password: "take10demo!" };
const DENTAL = "bright-smile-dental";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(AGENCY.email);
  await page.getByLabel("Password").fill(AGENCY.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/workspaces|\/w\//);
}

test.describe("automations", () => {
  test("creates, edits, and publishes an automation", async ({ page }) => {
    await signIn(page);
    await page.goto(`/w/${DENTAL}/automations`);

    const name = `E2E welcome ${Date.now()}`;
    await page.getByPlaceholder("New patient welcome").fill(name);
    await page.getByRole("button", { name: "New automation" }).click();

    await expect(page.getByText(name)).toBeVisible();
    await page.getByText(name).click();
    await page.waitForURL(/\/automations\/[a-z0-9]+/i);

    // The starter graph is a trigger plus one email.
    await expect(page.getByText("Trigger")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Wait" })).toBeVisible();

    // Add a wait, which must not break validation.
    await page.getByRole("button", { name: "+ Wait" }).click();

    await page
      .getByRole("button", { name: /Publish & activate|Publish changes/ })
      .click();

    await expect(page.getByText("ACTIVE").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("blocks publishing a graph with an unreachable step", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/w/${DENTAL}/automations`);

    const name = `E2E broken ${Date.now()}`;
    await page.getByPlaceholder("New patient welcome").fill(name);
    await page.getByRole("button", { name: "New automation" }).click();
    await page.getByText(name).click();
    await page.waitForURL(/\/automations\/[a-z0-9]+/i);

    // An if/else whose branches both end the run leaves the steps after it
    // unreachable, which must be caught before it can go live.
    await page.getByRole("button", { name: "+ If / else" }).click();
    await page.getByRole("button", { name: "+ Send email" }).click();

    await expect(page.getByText("Fix before publishing")).toBeVisible();
    await expect(page.getByText(/can never be reached/)).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Publish/ }),
    ).toBeDisabled();
  });

  test("runs a published sequence end to end and delivers the email", async ({
    page,
    request,
  }) => {
    await signIn(page);
    await page.goto(`/w/${DENTAL}/automations`);

    const name = `E2E delivery ${Date.now()}`;
    await page.getByPlaceholder("New patient welcome").fill(name);
    await page.getByRole("button", { name: "New automation" }).click();
    await page.getByText(name).click();
    await page.waitForURL(/\/automations\/[a-z0-9]+/i);

    const subject = `E2E subject ${Date.now()}`;
    await page.getByLabel("Subject").fill(subject);

    // Without this the send is (correctly) deferred whenever the suite happens
    // to run inside the workspace's quiet hours, which made the test depend on
    // the wall clock.
    await page.getByRole("checkbox").last().check();

    await page
      .getByRole("button", { name: /Publish & activate|Publish changes/ })
      .click();
    await expect(page.getByText("ACTIVE").first()).toBeVisible({
      timeout: 15_000,
    });

    // Enrol the first contact in the picker.
    const picker = page.locator("select").last();
    const value = await picker
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await picker.selectOption(value!);
    await page.getByRole("button", { name: "Enrol" }).click();
    await expect(page.getByText(/Enrolled/)).toBeVisible({ timeout: 15_000 });

    // Drive the real production heartbeat rather than a dev-only backdoor —
    // /api/dev/tick and /dev/inbox are both correctly 404 in a prod build.
    const ticked = await request.get("/api/cron", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    expect(ticked.status()).toBe(200);

    const drained = await ticked.json();
    expect(drained.succeeded).toBeGreaterThan(0);

    // The run finished and the send is recorded against the automation.
    await page.reload();
    await expect(page.getByText("COMPLETED").first()).toBeVisible({
      timeout: 15_000,
    });

    // "Messages sent" must have moved off zero — the sequence actually
    // delivered rather than merely completing.
    const sent = await page
      .locator("p", { hasText: /^Messages sent$/ })
      .locator("xpath=following-sibling::p[1]")
      .first()
      .innerText();
    expect(Number(sent.trim())).toBeGreaterThan(0);
  });
});

test.describe("unsubscribe", () => {
  test("rejects a forged token", async ({ page }) => {
    await signIn(page);

    // Grab a real contact id from the CRM, then use a wrong token.
    await page.goto(`/w/${DENTAL}/contacts`);
    const href = await page
      .locator('a[href*="/contacts/"]')
      .first()
      .getAttribute("href");
    const contactId = href!.split("/contacts/")[1]!;

    const response = await page.goto(`/u/${contactId}/not-a-real-token`);
    expect(response?.status()).toBe(404);
  });

  test("rejects an unknown contact", async ({ page }) => {
    const response = await page.goto("/u/does-not-exist/whatever");
    expect(response?.status()).toBe(404);
  });
});
