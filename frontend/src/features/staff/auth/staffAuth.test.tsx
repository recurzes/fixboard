import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A stand-in for Neon and the backend. `cookie` is whether the browser holds a session. */
function fakeServers({
  cookie = false,
  me = () => json({ name: "Sam Lee", email: "sam@example.com" }),
  token = () => json({ token: "jwt" }),
}: {
  cookie?: boolean;
  me?: () => Response;
  token?: () => Response | Promise<Response>;
} = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${AUTH}/token`) {
      return cookie ? token() : json({ code: "UNAUTHORIZED" }, 401);
    }
    if (url === `${AUTH}/sign-in/email`) {
      const { password } = JSON.parse(init!.body as string);
      if (password !== "right") return json({ code: "INVALID" }, 401);
      cookie = true;
      return json({});
    }
    if (url === `${AUTH}/sign-out`) {
      cookie = false;
      return json({});
    }
    if (url === `${API}/api/staff/me`) return me();
    if (url === `${API}/api/staff/requests/summary`) {
      return json({
        by_status: { new: 0, scheduled: 0, waiting_on_vendor: 0, done: 0 },
        open_urgent: 0,
        open_needs_review: 0,
      });
    }
    if (url.startsWith(AUTH)) return json({ status: true });
    throw new Error(`Unexpected call to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    called: (url: string) =>
      fetchMock.mock.calls.filter(([called]) => called === url),
  };
}

async function open(url: string, queryClient = new QueryClient()) {
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const container = document.createElement("div");
  document.body.append(container);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, router };
}

const cleanups: (() => void)[] = [];

afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  fakeServers();
  await signOut();
});

const heading = (container: HTMLElement) =>
  container.querySelector("h1")?.textContent;

const seesHeading = (container: HTMLElement, text: string) =>
  vi.waitFor(() => expect(heading(container)).toBe(text));

async function fillAndSubmit(
  container: HTMLElement,
  values: Record<string, string>,
) {
  for (const [name, value] of Object.entries(values)) {
    container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value =
      value;
  }
  await act(async () => container.querySelector("form")!.requestSubmit());
}

const signInWith = (container: HTMLElement, password: string) =>
  fillAndSubmit(container, { email: "sam@example.com", password });

it("a deep link while signed out goes to login, then back to it", async () => {
  fakeServers();
  const { container, router } = await open("/staff/requests/7?tab=notes");
  await seesHeading(container, "Staff sign in");
  expect(router.state.location.pathname).toBe("/staff/login");

  await signInWith(container, "right");

  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe("/staff/requests/7"),
  );
  expect(router.state.location.search).toBe("?tab=notes");
});

it("ignores a crafted link that names an off-site page", async () => {
  fakeServers();
  const { container, router } = await open(
    "/staff/login?from=https://evil.example&next=https://evil.example",
  );
  await seesHeading(container, "Staff sign in");

  await signInWith(container, "right");

  await seesHeading(container, "Requests");
  expect(router.state.location.pathname).toBe("/staff");
});

it("a wrong password shows the message and stays on login", async () => {
  fakeServers();
  const { container } = await open("/staff/login");
  await seesHeading(container, "Staff sign in");

  await signInWith(container, "wrong");

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Wrong email or password",
  );
  expect(heading(container)).toBe("Staff sign in");
  expect(container.textContent).not.toMatch(/sign up/i);
});

it("explains when the browser drops the cookie after a good sign-in", async () => {
  // What Safari does: the sign-in succeeds, but the next call has no cookie.
  const { fetchMock } = fakeServers();
  const { container } = await open("/staff/login");
  await seesHeading(container, "Staff sign in");
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/token") ? json({}, 401) : json({}),
  );

  await signInWith(container, "right");

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "blocked the sign-in cookie",
  );
});

it("a refresh with a session waits, and never flashes the login page", async () => {
  let answerToken!: (response: Response) => void;
  fakeServers({
    cookie: true,
    token: () => new Promise((resolve) => (answerToken = resolve)),
  });

  const { container, router } = await open("/staff/vendors");

  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector("form")).toBeNull();
  expect(router.state.location.pathname).toBe("/staff/vendors");

  await act(async () => answerToken(json({ token: "jwt" })));

  await seesHeading(container, "Vendors");
  expect(router.state.location.pathname).toBe("/staff/vendors");
});

it("a signed-in user who is not staff is refused and signed out", async () => {
  const { called } = fakeServers({
    me: () => json({ error: { code: "forbidden" } }, 403),
  });
  const { container, router } = await open("/staff/login");
  await seesHeading(container, "Staff sign in");

  await signInWith(container, "right");

  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This account isn't set up for staff",
    ),
  );
  expect(router.state.location.pathname).toBe("/staff/login");
  expect(called(`${AUTH}/sign-out`)).toHaveLength(1);
  expect(container.querySelector("nav")).toBeNull();
});

it("no staff page renders before the staff check passes", async () => {
  let answerMe!: (response: Response) => void;
  fakeServers({
    cookie: true,
    me: () => new Promise((resolve) => (answerMe = resolve)) as never,
  });

  const { container } = await open("/staff/vendors");
  await vi.waitFor(() => expect(answerMe).toBeDefined());

  expect(container.querySelector("nav")).toBeNull();
  expect(heading(container)).toBeUndefined();

  await act(async () => answerMe(json({ name: "Sam Lee", email: "s@e.co" })));
  await seesHeading(container, "Vendors");
});

it("a 503 from the staff check offers a retry and signs nobody out", async () => {
  let down = true;
  const { called } = fakeServers({
    cookie: true,
    me: () =>
      down
        ? json({ error: { code: "service_unavailable" } }, 503)
        : json({ name: "Sam Lee", email: "sam@example.com" }),
  });

  const { container } = await open("/staff");

  const retry = await vi.waitFor(() => {
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Try again");
    return button!;
  });
  expect(called(`${AUTH}/sign-out`)).toHaveLength(0);

  down = false;
  await act(async () => retry.click());
  await seesHeading(container, "Requests");
});

it("shows the staff name and nav, and Sign out returns to login", async () => {
  const { called } = fakeServers({ cookie: true });
  const queryClient = new QueryClient();
  const { container, router } = await open("/staff", queryClient);
  await seesHeading(container, "Requests");

  expect(container.querySelector("header")?.textContent).toContain("Sam Lee");
  const links = [...container.querySelectorAll("nav a")];
  expect(links.map((link) => link.textContent)).toEqual([
    "Requests",
    "Log request",
    "Vendors",
  ]);
  expect(links[0].getAttribute("aria-current")).toBe("page");

  await act(async () => (links[2] as HTMLElement).click());
  await seesHeading(container, "Vendors");
  await act(async () => (links[1] as HTMLElement).click());
  await seesHeading(container, "Log request");

  const signOutButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Sign out",
  )!;
  await act(async () => signOutButton.click());

  await seesHeading(container, "Staff sign in");
  expect(router.state.location.pathname).toBe("/staff/login");
  expect(called(`${AUTH}/sign-out`)).toHaveLength(1);
  // The next person on this computer must not get the last one's cached data.
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("asks for a reset link with the same answer for any address", async () => {
  const { called } = fakeServers();
  const { container } = await open("/staff/forgot-password");

  await fillAndSubmit(container, { value: "sam@example.com" });

  const [[, init]] = called(`${AUTH}/request-password-reset`);
  expect(JSON.parse(init!.body as string)).toEqual({
    email: "sam@example.com",
    redirectTo: `${window.location.origin}/staff/reset-password`,
  });
  expect(container.textContent).toContain("If that email has a staff account");
});

it("saves a new password with the token from the emailed link", async () => {
  const { called } = fakeServers();
  const { container } = await open("/staff/reset-password?token=abc");

  await fillAndSubmit(container, { value: "a-new-password" });

  const [[, init]] = called(`${AUTH}/reset-password`);
  expect(JSON.parse(init!.body as string)).toEqual({
    token: "abc",
    newPassword: "a-new-password",
  });
  expect(container.textContent).toContain("Your password is saved");
});

it.each([
  ["INVALID_TOKEN", "expired or was already used"],
  ["PASSWORD_TOO_SHORT", "8 to 128 characters"],
])("a reset refused with %s explains why", async (code, message) => {
  const { fetchMock } = fakeServers();
  const { container } = await open("/staff/reset-password?token=abc");
  fetchMock.mockImplementation(async () => json({ code }, 400));

  await fillAndSubmit(container, { value: "a-new-password" });

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    message,
  );
});

it("a reset link with no token, as Neon sends for a bad one, offers a new link", async () => {
  fakeServers();
  const { container } = await open("/staff/reset-password?error=INVALID_TOKEN");

  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('[role="alert"] a')?.textContent).toBe(
    "Request a new one.",
  );
});
