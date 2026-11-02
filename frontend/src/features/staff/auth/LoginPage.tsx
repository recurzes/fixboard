import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Button } from "../../../shared/ui/Button";
import { Alert, Spinner } from "../../../shared/ui/Feedback";
import { TextInput } from "../../../shared/ui/Field";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { session, loading, notice, signIn } = useAuth();
  // History state, not a URL parameter, so a crafted link can't send staff off-site after sign-in.
  const { state } = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (session) return <Navigate to={state?.from ?? "/staff"} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      await signIn(String(form.get("email")), String(form.get("password")));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-bold">Staff sign in</h1>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {(error || notice) && <Alert variant="error">{error ?? notice}</Alert>}
        <TextInput
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <TextInput
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-4">
        <Link to="/staff/forgot-password" className="text-blue-700 underline">
          Forgot or need to set your password?
        </Link>
      </p>
    </main>
  );
}
