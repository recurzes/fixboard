import * as Sentry from "@sentry/react";
import { expect, it, vi } from "vitest";
import { initSentry } from "./sentry";

it("sends an event with no typed data, input breadcrumbs, or request bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  initSentry("https://key@sentry.test.invalid/1");
  const sent: unknown[] = [];
  Sentry.getClient()!.on("beforeEnvelope", (envelope) => sent.push(envelope));

  const input = document.createElement("input");
  input.name = "tenant_name";
  input.value = "Jane Typed";
  document.body.append(input);
  input.click();
  input.dispatchEvent(
    new KeyboardEvent("keypress", { key: "J", bubbles: true }),
  );
  console.log("Console Jane");
  await fetch("https://api.test.invalid/api/staff/requests?q=Searched+Jane", {
    method: "POST",
    body: JSON.stringify({ tenant_name: "Body Jane" }),
  });
  history.pushState({}, "", "/staff?q=History+Jane");

  Sentry.captureException(
    new Error(
      "Failed for jane@example.com, (555) 123-4567, https://bucket.test/a.jpg?X-Signature=abc",
    ),
    {
      extra: {
        tenant_name: "Extra Jane",
        entry_notes: "Notes Jane",
        followup_answers: { q1: "Answer Jane" },
      },
    },
  );
  await Sentry.flush();

  const payload = JSON.stringify(sent);
  // Proves the event and its breadcrumbs went through, so the checks below mean something.
  expect(payload).toContain("Failed for");
  expect(payload).toContain("https://api.test.invalid/api/staff/requests");
  expect(payload).toContain("https://bucket.test/a.jpg");
  for (const secret of [
    "Jane",
    "jane@example.com",
    "123-4567",
    "X-Signature",
    "ui.input",
    "ui.click",
  ]) {
    expect(payload).not.toContain(secret);
  }
});
