import { config } from "./config";

const UNAVAILABLE = "Sign-in isn't available right now. Try again in a moment.";

// The session is Neon's HTTP-only cookie, which survives a refresh. The 15-minute token stays in memory.
let token: string | null = null;
let refreshing: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

export const getToken = () => token;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setToken(value: string | null) {
  token = value;
  listeners.forEach((listener) => listener());
}

async function authFetch(path: string, body?: object) {
  try {
    return await fetch(`${config.neonAuthUrl}${path}`, {
      method: body ? "POST" : "GET",
      // The cookie belongs to Neon's domain, so it is only sent if asked for.
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(UNAVAILABLE);
  }
}

/** Gets a new token from the cookie. Null means no session. Throws if Neon can't say, which must not sign anyone out. */
export function refreshToken() {
  refreshing ??= (async () => {
    const response = await authFetch("/token");
    if (response.status === 401) {
      setToken(null);
      return null;
    }
    if (!response.ok) throw new Error(UNAVAILABLE);
    const { token: fresh } = (await response.json()) as { token: string };
    setToken(fresh);
    return fresh;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(email: string, password: string) {
  const response = await authFetch("/sign-in/email", { email, password });
  if (response.status === 400 || response.status === 401) {
    throw new Error("Wrong email or password");
  }
  if (response.status === 429) {
    throw new Error("Too many tries. Wait a minute and try again.");
  }
  if (!response.ok) throw new Error(UNAVAILABLE);
  // Safari blocks third-party cookies, so the sign-in works and the next call has no session.
  if (!(await refreshToken())) {
    throw new Error(
      "This browser blocked the sign-in cookie. Allow cross-site cookies or use another browser.",
    );
  }
}

export async function signOut() {
  setToken(null);
  // shortcut: if this call fails the cookie stays valid and a refresh signs back in, add a retry if staff see it.
  await authFetch("/sign-out", {}).catch(() => {});
}

export async function requestPasswordReset(email: string) {
  const response = await authFetch("/request-password-reset", {
    email,
    redirectTo: `${window.location.origin}/staff/reset-password`,
  });
  if (response.status === 429) {
    throw new Error("Too many tries. Wait a minute and try again.");
  }
  if (!response.ok) throw new Error(UNAVAILABLE);
}

export async function resetPassword(resetToken: string, newPassword: string) {
  const response = await authFetch("/reset-password", {
    token: resetToken,
    newPassword,
  });
  if (response.status === 400) {
    const { code } = (await response.json()) as { code?: string };
    throw new Error(
      code?.startsWith("PASSWORD")
        ? "Choose a password with 8 to 128 characters."
        : "This link has expired or was already used. Request a new one.",
    );
  }
  if (!response.ok) throw new Error(UNAVAILABLE);
}
