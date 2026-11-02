import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { requestPasswordReset, resetPassword } from "../../../shared/lib/auth";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Feedback";
import { TextInput } from "../../../shared/ui/Field";

// Neon's API creates accounts with no password, so this is also how new staff set their first one.

function PasswordForm({
  title,
  submitLabel,
  field,
  doneText,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  field: ReactNode;
  doneText: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(String(form.get("value")));
      setDone(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {done ? (
        <Alert variant="info">{doneText}</Alert>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {field}
          <Button type="submit" loading={submitting} className="w-full">
            {submitLabel}
          </Button>
        </form>
      )}
      <p className="mt-4">
        <Link to="/staff/login" className="text-blue-700 underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}

export function ForgotPasswordPage() {
  return (
    <PasswordForm
      title="Set your password"
      submitLabel="Email me a link"
      field={
        <TextInput
          label="Email"
          name="value"
          type="email"
          autoComplete="username"
          required
        />
      }
      // The same answer for any address, so this page can't reveal who is staff.
      doneText="If that email has a staff account, a link to set the password is on its way. It works for 15 minutes."
      onSubmit={requestPasswordReset}
    />
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  if (!token) {
    return (
      <main className="mx-auto max-w-sm space-y-4 p-4">
        <h1 className="text-2xl font-bold">Set your password</h1>
        <Alert variant="error">
          This link has expired or was already used.{" "}
          <Link to="/staff/forgot-password" className="underline">
            Request a new one.
          </Link>
        </Alert>
      </main>
    );
  }
  return (
    <PasswordForm
      title="Set your password"
      submitLabel="Save password"
      field={
        <TextInput
          label="New password"
          hint="8 to 128 characters."
          name="value"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      }
      doneText="Your password is saved. You can sign in now."
      onSubmit={(password) => resetPassword(token, password)}
    />
  );
}
