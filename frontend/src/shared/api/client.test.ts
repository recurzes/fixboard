import { afterEach, describe, expect, it, vi } from "vitest";
import { getToken, refreshToken, signOut } from "../lib/auth";
import { apiFetch, ApiError } from "./client";

function respondWith(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => expect.unreachable("expected the request to fail"),
    (error: ApiError) => error,
  );

afterEach(() => vi.unstubAllGlobals());

it("turns a 422 into an ApiError with its code and fields", async () => {
  const fields = [{ field: "body.phone", message: "Invalid phone" }];
  respondWith(
    JSON.stringify({
      error: { code: "validation_error", message: "Invalid request", fields },
    }),
    422,
  );

  const error = await failure(apiFetch("/api/public/requests"));

  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    status: 422,
    code: "validation_error",
    message: "Invalid request",
    fields,
  });
});

it("returns parsed JSON and sends JSON bodies with a Content-Type", async () => {
  const fetchMock = respondWith('{"id":1}');

  await expect(
    apiFetch("/api/x", { method: "POST", body: { a: 1 } }),
  ).resolves.toEqual({ id: 1 });

  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test.invalid/api/x",
    expect.objectContaining({
      body: '{"a":1}',
      headers: { "Content-Type": "application/json" },
    }),
  );
});

it("leaves the Content-Type to the browser for FormData", async () => {
  const fetchMock = respondWith("{}");
  const body = new FormData();

  await apiFetch("/api/x", { method: "POST", body });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ body, headers: undefined }),
  );
});

it("returns undefined for an empty success", async () => {
  respondWith("");
  await expect(apiFetch("/api/x")).resolves.toBeUndefined();
});

it("does not crash on an error that is not JSON", async () => {
  respondWith("<html>Bad gateway</html>", 502);
  expect(await failure(apiFetch("/api/x"))).toMatchObject({
    status: 502,
    code: "invalid_response",
  });
});

it("reports a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed")));
  expect(await failure(apiFetch("/api/x"))).toMatchObject({
    status: 0,
    code: "network_error",
  });
});

it("times out, and lets a caller set the time", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason)),
        ),
    ),
  );
  expect(await failure(apiFetch("/api/x", { timeoutMs: 5 }))).toMatchObject({
    status: 0,
    code: "timeout",
  });
});

describe("staff calls", () => {
  const TOKEN_URL = "https://auth.test.invalid/token";
  const SIGN_OUT_URL = "https://auth.test.invalid/sign-out";

  /** Answers the API with `api` in order, the last one repeating, and hands out fresh-1, fresh-2, and so on. */
  function backend(api: number[], tokenStatus = 200) {
    const statuses = [...api];
    let issued = 0;
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async (url) => {
      if (url === TOKEN_URL) {
        return new Response(JSON.stringify({ token: `fresh-${++issued}` }), {
          status: tokenStatus,
        });
      }
      if (url === SIGN_OUT_URL) return new Response("{}");
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0];
      return new Response(status === 200 ? '{"ok":true}' : "{}", { status });
    });
    vi.stubGlobal("fetch", fetchMock);
    return {
      calls: (url: string) =>
        fetchMock.mock.calls.filter(([called]) => called === url).length,
      bearers: () =>
        fetchMock.mock.calls
          .filter(([url]) => url.includes("/api/"))
          .map(
            ([, init]) =>
              (init?.headers as Record<string, string>)?.Authorization,
          ),
    };
  }

  const signedIn = async () => {
    backend([200]);
    await refreshToken();
    expect(getToken()).toBe("fresh-1");
  };

  afterEach(async () => {
    backend([200]);
    await signOut();
  });

  it("adds the token to staff calls and never to public ones", async () => {
    await signedIn();
    const { bearers } = backend([200]);

    await apiFetch("/api/staff/me");
    await apiFetch("/api/public/properties");

    expect(bearers()).toEqual(["Bearer fresh-1", undefined]);
  });

  it("an expired token triggers one refresh and one retry", async () => {
    await signedIn();
    const { calls, bearers } = backend([401, 200]);

    await expect(apiFetch("/api/staff/me")).resolves.toEqual({ ok: true });

    expect(calls(TOKEN_URL)).toBe(1);
    expect(bearers()).toEqual(["Bearer fresh-1", "Bearer fresh-1"]);
    expect(calls(SIGN_OUT_URL)).toBe(0);
  });

  it("a second 401 signs out, and refreshes no further", async () => {
    await signedIn();
    const { calls } = backend([401]);

    expect(await failure(apiFetch("/api/staff/me"))).toMatchObject({
      status: 401,
    });

    expect(calls(TOKEN_URL)).toBe(1);
    expect(calls(SIGN_OUT_URL)).toBe(1);
    expect(getToken()).toBeNull();
  });

  it("a session that ended fails without a retry", async () => {
    await signedIn();
    const { calls, bearers } = backend([401], 401);

    expect(await failure(apiFetch("/api/staff/me"))).toMatchObject({
      status: 401,
    });

    expect(bearers()).toHaveLength(1);
    expect(calls(TOKEN_URL)).toBe(1);
    expect(getToken()).toBeNull();
  });

  it("calls that fail together share one refresh", async () => {
    await signedIn();
    const { calls } = backend([401, 401, 200]);

    await Promise.all([apiFetch("/api/staff/a"), apiFetch("/api/staff/b")]);

    expect(calls(TOKEN_URL)).toBe(1);
  });

  it("a 503 from the API signs nobody out", async () => {
    await signedIn();
    const { calls } = backend([503]);

    expect(await failure(apiFetch("/api/staff/me"))).toMatchObject({
      status: 503,
    });

    expect(calls(TOKEN_URL)).toBe(0);
    expect(getToken()).toBe("fresh-1");
  });

  it.each([
    ["is down", 500],
    ["rate limits", 429],
  ])("signs nobody out when Neon %s during a refresh", async (_, status) => {
    await signedIn();
    const { calls } = backend([401], status);

    expect(await failure(apiFetch("/api/staff/me"))).toMatchObject({
      status: 0,
      code: "network_error",
    });

    expect(calls(SIGN_OUT_URL)).toBe(0);
    expect(getToken()).toBe("fresh-1");
  });
});
