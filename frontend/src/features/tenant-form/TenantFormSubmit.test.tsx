import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { fakeImageApis, photo } from "./photos.testutil";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const API = "https://api.test.invalid/api/public";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const CONFIG = {
  emergency_number: "(000) 000-0000",
  require_emergency_ack: true,
  form_enabled: true,
  categories: [
    {
      id: "plumbing",
      label: "Plumbing",
      questions: [
        {
          id: "problem",
          label: "Problem?",
          type: "single_choice",
          required: true,
          options: [
            { value: "leak", label: "Leak", urgent: false, self_check: null },
            { value: "other", label: "Other", urgent: false, self_check: null },
          ],
        },
      ],
    },
  ],
};

const CREATED = () => json({ reference_number: "MR-1001" }, 201);
const failure = (status: number, code: string, fields?: object[]) => () =>
  json({ error: { code, message: "From the server", fields } }, status);

/** `answers` is what each POST gets in turn. A thrown one is a network failure. */
function fakeApi(answers: (() => Response)[] = [], config: object = CONFIG) {
  const posts: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(init);
        return (answers.shift() ?? CREATED)();
      }
      if (url === `${API}/config`) return json(config);
      if (url === `${API}/properties`) return json([{ id: 1, name: "Oak" }]);
      return json([{ id: 11, label: "1A" }]);
    }),
  );
  return posts;
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function open(initialEntries = ["/"]) {
  vi.stubGlobal("scrollTo", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
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

const control = <T extends HTMLElement = HTMLInputElement>(
  container: HTMLElement,
  name: string,
) => container.querySelector<T>(`[name="${name}"]`)!;

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );

const clickButton = (container: HTMLElement, text: string) =>
  act(async () => button(container, text)!.click());

async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(element);
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

const radio = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")]
    .find((candidate) => candidate.textContent === label)!
    .querySelector("input")!;

async function fillToStep3(container: HTMLElement) {
  await vi.waitFor(() =>
    expect(control(container, "property_id").disabled).toBe(false),
  );
  await change(control(container, "property_id"), "1");
  await vi.waitFor(() =>
    expect(control(container, "unit_id").disabled).toBe(false),
  );
  await change(control(container, "unit_id"), "11");
  await change(control(container, "tenant_name"), "Sam");
  await change(control(container, "email"), "sam@example.com");
  await clickButton(container, "Next");
  await act(async () => radio(container, "Plumbing").click());
  await act(async () => radio(container, "Leak").click());
  await clickButton(container, "Next");
  await change(control(container, "description"), "It drips");
  await act(async () => radio(container, "Anytime").click());
  await act(async () => radio(container, "This is not an emergency").click());
}

async function ready() {
  const opened = await open();
  await fillToStep3(opened.container);
  return opened;
}

const submit = (container: HTMLElement, text = "Submit") =>
  clickButton(container, text);

const key = (post: RequestInit) =>
  (post.headers as Record<string, string>)["Idempotency-Key"];

const alertText = (container: HTMLElement) =>
  container.querySelector('form [role="alert"]')?.textContent;

const stepHeading = (container: HTMLElement) =>
  container.querySelector("h2")?.textContent;

it("posts the form as multipart with a key the backend accepts, and shows the number", async () => {
  const posts = fakeApi();
  const { container } = await ready();

  await submit(container);

  expect(posts).toHaveLength(1);
  const body = posts[0].body as FormData;
  expect(JSON.parse(body.get("data") as string)).toMatchObject({
    unit_id: 11,
    tenant_name: "Sam",
    followup_answers: { problem: "leak" },
    website: "",
  });
  expect(key(posts[0]).length).toBeGreaterThanOrEqual(16);
  await vi.waitFor(() => expect(container.textContent).toContain("MR-1001"));
  expect(container.textContent).toContain("You won't get emails");
  expect(document.activeElement).toBe(container.querySelector("h1"));
});

it("sends the prepared photos, not the originals", async () => {
  fakeImageApis();
  const posts = fakeApi();
  const { container } = await ready();
  await act(async () => {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [photo("a.png", "image/png")],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() =>
    expect(button(container, "Submit")?.disabled).toBe(false),
  );

  await submit(container);

  const sent = (posts[0].body as FormData).getAll("photos") as File[];
  expect(sent.map(({ name, type }) => [name, type])).toEqual([
    ["a.jpg", "image/jpeg"],
  ]);
});

it("carries a filled honeypot, which stays out of the keyboard's way", async () => {
  const posts = fakeApi();
  const { container } = await ready();
  const trap = control(container, "website");

  expect(trap.tabIndex).toBe(-1);
  expect(trap.autocomplete).toBe("off");
  expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  await change(trap, "spam.example");
  await submit(container);

  const body = posts[0].body as FormData;
  expect(JSON.parse(body.get("data") as string).website).toBe("spam.example");
});

it("sends one request for a double click, and locks the buttons while sending", async () => {
  let finish: (response: Response) => void = () => {};
  const posts = fakeApi([]);
  const { container } = await ready();
  const inner = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) =>
    init?.method === "POST"
      ? (posts.push(init), new Promise((resolve) => (finish = resolve)))
      : inner(url as never, init as never),
  );

  await act(async () => {
    const submitButton = button(container, "Submit")!;
    submitButton.click();
    submitButton.click();
  });

  expect(posts).toHaveLength(1);
  await vi.waitFor(() =>
    expect(button(container, "Back")?.disabled).toBe(true),
  );
  const sending = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.type === "submit")!;
  expect(sending.disabled).toBe(true);
  expect(sending.textContent).toContain("Sending");

  await act(async () => finish(CREATED()));
  await vi.waitFor(() => expect(container.textContent).toContain("MR-1001"));
});

it("keeps every answer on a network failure, and retries with the same key", async () => {
  const posts = fakeApi([
    () => {
      throw new TypeError("Failed to fetch");
    },
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() =>
    expect(alertText(container)).toContain("everything you entered"),
  );
  expect(
    container.querySelector('form [role="alert"] a[href^="tel:"]'),
  ).not.toBeNull();
  expect(control<HTMLTextAreaElement>(container, "description").value).toBe(
    "It drips",
  );

  await submit(container, "Try again");

  expect(posts).toHaveLength(2);
  expect(key(posts[1])).toBe(key(posts[0]));
  await vi.waitFor(() => expect(container.textContent).toContain("MR-1001"));
});

it("uses a new key for the form after a success, and Back doesn't resubmit", async () => {
  const posts = fakeApi();
  const { container, router } = await ready();
  await submit(container);
  await vi.waitFor(() => expect(container.textContent).toContain("MR-1001"));

  await act(async () => router.navigate(-1));

  expect(posts).toHaveLength(1);
  await vi.waitFor(() =>
    expect(control(container, "tenant_name").value).toBe(""),
  );
  await fillToStep3(container);
  await submit(container);
  expect(posts).toHaveLength(2);
  expect(key(posts[1])).not.toBe(key(posts[0]));
});

it.each([
  [429, "too_many_requests", "Too many requests"],
  [413, "request_entity_too_large", "too large"],
  [503, "service_unavailable", "everything you entered"],
])(
  "on a %i keeps every answer and gives the number",
  async (status, code, text) => {
    fakeApi([failure(status, code)]);
    const { container } = await ready();

    await submit(container);

    await vi.waitFor(() => expect(alertText(container)).toContain(text));
    expect(
      container.querySelector('form [role="alert"] a[href^="tel:"]'),
    ).not.toBeNull();
    expect(control<HTMLTextAreaElement>(container, "description").value).toBe(
      "It drips",
    );
  },
);

it("clears a failure's message on leaving the step", async () => {
  fakeApi([failure(429, "too_many_requests")]);
  const { container } = await ready();
  await submit(container);
  await vi.waitFor(() =>
    expect(alertText(container)).toContain("Too many requests"),
  );

  await clickButton(container, "Back");

  expect(alertText(container)).toBeUndefined();
});

it("on a 422 jumps to the earliest step, marks the field, focuses it, and keeps answers", async () => {
  const posts = fakeApi([
    failure(422, "validation_error", [
      { field: "body.description", message: "Value error, nope" },
      { field: "body.email", message: "Value error, nope" },
    ]),
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() => expect(stepHeading(container)).toContain("Step 1"));
  const email = control(container, "email");
  expect(email.value).toBe("sam@example.com");
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(email);
  expect(container.textContent).toContain("Enter a valid email address");
  expect(container.textContent).not.toContain("Value error");

  await change(email, "sam@example.org");
  expect(email.getAttribute("aria-invalid")).not.toBe("true");
  await clickButton(container, "Next");
  await clickButton(container, "Next");
  await submit(container);
  expect(posts).toHaveLength(2);
  expect(key(posts[1])).toBe(key(posts[0]));
});

it("puts the phone-or-email rule, which names no field, on the phone", async () => {
  fakeApi([
    failure(422, "validation_error", [{ field: "body", message: "x" }]),
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() => expect(stepHeading(container)).toContain("Step 1"));
  expect(document.activeElement).toBe(control(container, "phone"));
});

it("marks a refused follow-up answer on step 2", async () => {
  fakeApi([
    failure(422, "validation_error", [
      { field: "body.followup_answers.problem", message: "Unknown option" },
    ]),
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() => expect(stepHeading(container)).toContain("Step 2"));
  expect(container.textContent).toContain("Check this answer");
  expect(document.activeElement).toBe(radio(container, "Leak"));
});

it("names a photo the server refused, and stays on step 3", async () => {
  fakeApi([
    failure(422, "validation_error", [
      { field: "body.photos.0", message: "Photos must be JPG" },
    ]),
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() =>
    expect(container.textContent).toContain("We couldn't use photo 1"),
  );
  expect(stepHeading(container)).toContain("Step 3");
  expect(control<HTMLTextAreaElement>(container, "description").value).toBe(
    "It drips",
  );
});

it("still says something when a 422 names no field it knows", async () => {
  fakeApi([
    failure(422, "validation_error", [{ field: "body.new", message: "x" }]),
  ]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() =>
    expect(alertText(container)).toContain("check the marked answers"),
  );
  expect(stepHeading(container)).toContain("Step 3");
});

it("shows the call-us screen instead of the form when the form is off", async () => {
  fakeApi([], { ...CONFIG, form_enabled: false });
  const { container } = await open();

  await vi.waitFor(() =>
    expect(container.textContent).toContain("This form is closed"),
  );
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('main a[href^="tel:"]')).not.toBeNull();
});

it("swaps to the call-us screen if the form closes while it's open, with no leave prompt", async () => {
  fakeApi([failure(503, "form_closed")]);
  const { container } = await ready();

  await submit(container);

  await vi.waitFor(() =>
    expect(container.textContent).toContain("This form is closed"),
  );
  expect(container.querySelector("form")).toBeNull();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(false);
});

it("takes the number out of history, so a refresh gets the neutral message", async () => {
  const { container, router } = await open([
    { pathname: "/done", state: { reference: "MR-1001" } } as never,
  ]);

  expect(container.textContent).toContain("MR-1001");
  await vi.waitFor(() => expect(router.state.location.state).toBeNull());
  expect(container.textContent).toContain("MR-1001");

  const refreshed = await open([router.state.location as never]);
  expect(refreshed.container.textContent).not.toContain("MR-1001");
  expect(refreshed.container.textContent).toContain(
    "If you already sent a request, you're all set",
  );
});

it("copies the number, and says so if the browser can't", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const { container } = await open([
    { pathname: "/done", state: { reference: "MR-1001" } } as never,
  ]);

  await clickButton(container, "Copy number");
  expect(writeText).toHaveBeenCalledWith("MR-1001");
  expect(container.textContent).toContain("Copied");

  writeText.mockRejectedValueOnce(new Error("denied"));
  await clickButton(container, "Copy number");
  expect(container.textContent).toContain("write it down");
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

// F110: the browser half of tenant privacy. The Sentry scrub has its own test in sentry.test.ts.
it("keeps typed values and the number out of storage, the console, and the URL", async () => {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const spies = methods.map((method) => vi.spyOn(console, method));
  cleanups.push(() => spies.forEach((spy) => spy.mockRestore()));
  // A failure first, so the error paths are covered too.
  fakeApi([
    () => {
      throw new TypeError("Failed to fetch");
    },
  ]);
  const { container, router } = await ready();
  // Every address, because the confirmation page replaces its own and would hide an earlier one.
  const visited = [router.state.location];
  cleanups.push(router.subscribe(({ location }) => visited.push(location)));
  await submit(container);
  await vi.waitFor(() => expect(button(container, "Try again")).toBeDefined());
  await submit(container, "Try again");
  await vi.waitFor(() => expect(container.textContent).toContain("MR-1001"));

  const secrets = ["sam@example.com", "It drips", "MR-1001"];
  // Neon Auth keeps its session in a cookie, so nothing should be stored at all.
  const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
  const logged = JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_, value) => (value instanceof Error ? value.message : value),
  );
  // Router state counts: browsers keep it through a refresh.
  const address = JSON.stringify([visited.at(-1), window.location.href]);
  const paths = JSON.stringify(
    visited.map(({ pathname, search, hash }) => pathname + search + hash),
  );
  for (const secret of secrets) {
    expect(stored).not.toContain(secret);
    expect(logged).not.toContain(secret);
    expect(address).not.toContain(secret);
    expect(paths).not.toContain(secret);
    expect(document.title).not.toContain(secret);
  }
});
