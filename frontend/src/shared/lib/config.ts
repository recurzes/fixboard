const REQUIRED = ["VITE_API_URL", "VITE_NEON_AUTH_URL"] as const;

export function findMissing(env: Record<string, unknown>) {
  return REQUIRED.filter((name) => !env[name]);
}

export const missingEnv = findMissing(import.meta.env);

// Required values are only read once missingEnv is empty, because main.tsx shows ConfigError otherwise.
export const config = {
  apiUrl: import.meta.env.VITE_API_URL?.replace(/\/+$/, ""),
  neonAuthUrl: import.meta.env.VITE_NEON_AUTH_URL?.replace(/\/+$/, ""),
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
};
