import { afterEach, expect, it, vi } from "vitest";
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
