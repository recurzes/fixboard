import { devices, expect, test } from "@playwright/test";

// The journey of backend/tests/smoke.py, through the screens, on the demo seed's properties and vendors.
// Its history events can't be deleted, so run it before real tenants arrive.

const { E2E_STAFF_EMAIL, E2E_STAFF_PASSWORD } = process.env;

// A 1x1 PNG, enough for the browser to resize and the server to accept.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a tenant's request reaches staff, who assign a vendor and close it", async ({
  browser,
  page,
}) => {
  expect(
    E2E_STAFF_EMAIL && E2E_STAFF_PASSWORD,
    "Set E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD",
  ).toBeTruthy();

  // The tenant is on a phone.
  const phone = await browser.newContext(devices["Pixel 7"]);
  const tenant = await phone.newPage();
  await tenant.goto("/");
  await tenant
    .getByLabel("Property")
    .selectOption({ label: "Demo - Palm Court" });
  await tenant.getByLabel("Unit").selectOption({ label: "101" });
  await tenant.getByLabel("Your name").fill("SMOKE TEST - please ignore");
  await tenant.getByLabel("Email").fill("smoke.test@example.com");
  await tenant.getByRole("button", { name: "Next" }).click();

  await tenant.getByLabel("Plumbing", { exact: true }).check();
  await tenant.getByLabel("A leak or drip").check();
  await tenant.getByLabel("Kitchen", { exact: true }).check();
  await tenant.getByRole("button", { name: "Next" }).click();

  await tenant
    .getByLabel("Describe the problem")
    .fill("Smoke test, please ignore.");
  await tenant
    .locator('input[type="file"]')
    .setInputFiles({ name: "smoke.png", mimeType: "image/png", buffer: PHOTO });
  await expect(
    tenant.getByRole("button", { name: "Remove photo 1, smoke.png" }),
  ).toBeVisible();
  await tenant.getByLabel("Anytime").check();
  await tenant.getByLabel("This is not an emergency").check();
  await tenant.getByRole("button", { name: "Submit" }).click();

  await expect(
    tenant.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();
  const reference = (await tenant.getByText(/^MR-\d+$/).textContent())!;
  await phone.close();

  // Staff are on a laptop.
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill(E2E_STAFF_EMAIL!);
  await page.getByLabel("Password").fill(E2E_STAFF_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page
      .getByRole("group", { name: "Request counts" })
      .getByRole("button", { name: /^New [1-9]\d*$/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: reference, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: reference }),
  ).toBeVisible();

  const save = page.getByRole("button", { name: "Save changes" });
  await page.getByLabel("Assignee").selectOption({ label: "Plumber" });
  await page.getByLabel("Status").selectOption({ label: "Waiting on vendor" });
  await save.click();
  // A saved draft has nothing left to save.
  await expect(save).toBeDisabled();

  await page.getByLabel("Status").selectOption({ label: "Done" });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByLabel("Status")).toHaveValue("done");
});
