import * as Sentry from "@sentry/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { initSentry } from "../shared/lib/sentry";
import { siteConfig } from "../shared/lib/siteConfig";
import { routes } from "./routes";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

it.each([
  ["/", "Tenant form"],
  ["/done", "Request received"],
  ["/staff/login", "Staff sign in"],
  ["/staff", "Staff dashboard"],
  ["/staff/requests/1", "Staff dashboard"],
  ["/nope", "Page not found"],
  ["/dev/ui", "UI demo"],
])("%s shows %s", async (url, heading) => {
  const container = document.createElement("div");
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  await act(async () =>
    createRoot(container).render(<RouterProvider router={router} />),
  );
  expect(container.querySelector("h1")?.textContent).toBe(heading);
});

it("a component that throws shows the emergency number and reaches Sentry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  initSentry("https://key@sentry.test.invalid/1");
  const sent: unknown[] = [];
  Sentry.getClient()!.on("beforeEnvelope", (envelope) => sent.push(envelope));

  const container = document.createElement("div");
  const router = createMemoryRouter(routes, {
    initialEntries: ["/dev/crash"],
  });
  // Same handler as main.tsx.
  await act(async () =>
    createRoot(container, {
      onCaughtError: Sentry.reactErrorHandler(),
    }).render(<RouterProvider router={router} />),
  );
  await Sentry.flush();

  expect(container.querySelector("h1")?.textContent).toBe(
    "We can't load this page right now",
  );
  expect(container.querySelector(`a[href^="tel:"]`)?.textContent).toBe(
    siteConfig.emergencyNumber,
  );
  expect(JSON.stringify(sent)).toContain("Demo crash");
});
