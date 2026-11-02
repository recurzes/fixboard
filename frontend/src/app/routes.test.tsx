import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { routes } from "./routes";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

it.each([
  ["/", "Tenant form"],
  ["/done", "Request received"],
  ["/staff/login", "Staff sign in"],
  ["/staff", "Staff dashboard"],
  ["/staff/requests/1", "Staff dashboard"],
  ["/nope", "Page not found"],
])("%s shows %s", async (url, heading) => {
  const container = document.createElement("div");
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  await act(async () =>
    createRoot(container).render(<RouterProvider router={router} />),
  );
  expect(container.querySelector("h1")?.textContent).toBe(heading);
});
