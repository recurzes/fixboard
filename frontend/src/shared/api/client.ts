import { getToken, refreshToken, signOut } from "../lib/auth";
import { config } from "../lib/config";

const DEFAULT_TIMEOUT_MS = 15_000;

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldError[];

  constructor(
    status: number,
    code: string,
    message: string,
    fields: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type ApiOptions = Omit<RequestInit, "body" | "headers" | "signal"> & {
  /** FormData is sent as is. Anything else is sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Photo uploads on slow phones need longer than the default. */
  timeoutMs?: number;
};

const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

export async function apiFetch<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  // Only staff calls carry the token, so a public call can never leak it.
  if (!path.startsWith("/api/staff")) return send<T>(path, options);

  const sendWith = (token: string) =>
    send<T>(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });

  const sent = getToken();
  try {
    if (sent) return await sendWith(sent);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }

  // Another call may have refreshed while this one was out.
  let fresh = getToken();
  if (fresh === sent) {
    fresh = await refreshToken().catch(() => {
      throw new ApiError(0, "network_error", "Could not reach the server");
    });
  }
  if (!fresh) throw new ApiError(401, "unauthorized", "Please sign in again");

  try {
    return await sendWith(fresh);
  } catch (error) {
    if (isUnauthorized(error)) await signOut();
    throw error;
  }
}

async function send<T>(
  path: string,
  { body, headers, timeoutMs = DEFAULT_TIMEOUT_MS, ...init }: ApiOptions,
): Promise<T> {
  // The browser sets the FormData Content-Type itself, because it holds the multipart boundary.
  const sendAsJson = body !== undefined && !(body instanceof FormData);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: sendAsJson
        ? { "Content-Type": "application/json", ...headers }
        : headers,
      body: sendAsJson ? JSON.stringify(body) : (body as FormData | undefined),
      signal,
    });
    text = await response.text();
  } catch {
    // An unhandled backend 500 has no CORS header, so it also lands here as a network failure.
    if (signal.aborted) {
      throw new ApiError(0, "timeout", "The request took too long");
    }
    throw new ApiError(0, "network_error", "Could not reach the server");
  }

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Not from FastAPI, such as a proxy's HTML error page.
    throw new ApiError(
      response.status,
      "invalid_response",
      "Something went wrong",
    );
  }
  if (!response.ok) {
    const error = (data as { error?: Partial<ApiError> } | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "invalid_response",
      error?.message ?? "Something went wrong",
      error?.fields,
    );
  }
  return data as T;
}
