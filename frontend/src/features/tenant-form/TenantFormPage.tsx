import { useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { flushSync } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { apiFetch } from "../../shared/api/client";
import type { ApiError } from "../../shared/api/client";
import { siteConfig } from "../../shared/lib/siteConfig";
import { useLeaveWarning } from "../../shared/lib/useLeaveWarning";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { Button } from "../../shared/ui/Button";
import { Alert, Spinner } from "../../shared/ui/Feedback";
import { DetailsStep } from "./DetailsStep";
import {
  formReducer,
  initialFormState,
  LAST_STEP,
} from "../../shared/form/formState";
import { IssueFields } from "../../shared/form/IssueFields";
import { LoadError } from "../../shared/form/LoadError";
import { LocationContactFields } from "../../shared/form/LocationContactFields";
import { usePhotos } from "./photos";
import {
  buildSubmission,
  newIdempotencyKey,
  placeFieldErrors,
} from "./submission";
import { usePublicConfig } from "../../shared/form/usePublicConfig";
import type { Category } from "../../shared/form/usePublicConfig";
import {
  validateStep1,
  validateStep2,
  validateStep3,
} from "../../shared/form/validation";

const STEP_TITLES: Record<number, string> = {
  1: "Your home and contact details",
  2: "The problem",
  3: "Details and access",
};

// Five photos on a slow phone connection take far longer than the default.
const SUBMIT_TIMEOUT_MS = 120_000;

function failureMessage({ status }: ApiError) {
  if (status === 422) {
    return "Please check the marked answers. If this keeps happening, call";
  }
  if (status === 429) return "Too many requests. Try again later, or call";
  if (status === 413) {
    return "Those photos are too large to send. Remove some and try again, or call";
  }
  return "We couldn't send your request, but everything you entered is still here. Try again, or call";
}

export function TenantFormPage() {
  const config = usePublicConfig();
  // For a page opened before the form was closed, which only finds out on submit.
  const [closedOnSubmit, setClosedOnSubmit] = useState(false);
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-2xl font-bold">Report a maintenance problem</h1>
      <Alert variant="warning">
        If anyone is in danger, or there is gas, fire, or flooding, don't use
        this form. Call <EmergencyLink />.
      </Alert>
      {config.data && (!config.data.form_enabled || closedOnSubmit) ? (
        <div>
          <h2 className="text-xl font-bold">This form is closed right now</h2>
          <p>
            To report a maintenance problem, please call <EmergencyLink />.
          </p>
        </div>
      ) : config.data ? (
        <TenantForm
          categories={config.data.categories}
          requireEmergencyAck={config.data.require_emergency_ack}
          onClosed={() => setClosedOnSubmit(true)}
        />
      ) : config.isError ? (
        <LoadError
          what="the form"
          retrying={config.isFetching}
          onRetry={() => void config.refetch()}
        />
      ) : (
        <div className="flex justify-center p-8">
          <Spinner label="Loading the form" />
        </div>
      )}
    </main>
  );
}

function TenantForm({
  categories,
  requireEmergencyAck,
  onClosed,
}: {
  categories: Category[];
  requireEmergencyAck: boolean;
  onClosed: () => void;
}) {
  const [{ step, fields }, dispatch] = useReducer(
    formReducer,
    initialFormState,
  );
  const photos = usePhotos();
  const [showErrors, setShowErrors] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const preparing = step === LAST_STEP && photos.preparing;
  const navigate = useNavigate();
  // What the server refused, and the values it refused, so any edit clears the errors.
  const [refused, setRefused] = useState<{
    errors: Record<string, string>;
    fields: typeof fields;
    items: typeof photos.items;
  } | null>(null);
  // Kept across failures, so a retry of a request that did land returns it instead of
  // making a second one. A success leaves the page, so the next form gets a new key.
  const idempotencyKey = useRef<string | null>(null);
  // isPending only updates on the next render, which a fast double click can beat.
  const sending = useRef(false);

  const submission = useMutation<
    { reference_number: string },
    ApiError,
    FormData
  >({
    mutationFn: (body) =>
      apiFetch("/api/public/requests", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey.current! },
        timeoutMs: SUBMIT_TIMEOUT_MS,
      }),
    onSuccess: ({ reference_number }) =>
      void navigate("/done", { state: { reference: reference_number } }),
    onError: (error) => {
      if (error.code === "form_closed") onClosed();
      if (error.status !== 422) return;
      const placed = placeFieldErrors(error.fields);
      flushSync(() => {
        setShowErrors(false);
        setRefused({ errors: placed.errors, fields, items: photos.items });
        if (placed.step) dispatch({ type: "goto", step: placed.step });
      });
      focusFirstInvalid();
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  // Drafts aren't saved, so this prompt is all that protects typed data.
  // Leaving for the confirmation page unmounts this, which removes the prompt.
  const hasData =
    photos.items.length > 0 ||
    JSON.stringify(fields) !== JSON.stringify(initialFormState.fields);
  useLeaveWarning(hasData);

  const stepErrors: Record<string, string> =
    step === 1
      ? validateStep1(fields)
      : step === 2
        ? validateStep2(fields, categories)
        : validateStep3(fields, requireEmergencyAck);
  const errors: Record<string, string> = {
    ...(refused?.fields === fields && refused.items === photos.items
      ? refused.errors
      : {}),
    ...(showErrors ? stepErrors : {}),
  };

  function move(type: "next" | "back") {
    // Flushed so focus lands after the new step is on the page.
    flushSync(() => {
      setShowErrors(false);
      submission.reset();
      dispatch({ type });
    });
    heading.current?.focus();
    window.scrollTo(0, 0);
  }

  function focusFirstInvalid() {
    // Page order is field order, so the first match is the first invalid field.
    const invalid = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(:disabled)',
    );
    // A radio group's fieldset can't take focus, so its first radio does.
    // A refused photo has no field, so the heading brings its step into view.
    (invalid?.querySelector("input") ?? invalid ?? heading.current)?.focus();
  }

  function send() {
    if (sending.current || photos.preparing) return;
    sending.current = true;
    idempotencyKey.current ??= newIdempotencyKey();
    submission.mutate(
      buildSubmission(
        fields,
        photos.items.flatMap(({ file }) => file ?? []),
      ),
    );
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(stepErrors).length === 0) {
      if (step < LAST_STEP) move("next");
      else send();
      return;
    }
    flushSync(() => setShowErrors(true));
    focusFirstInvalid();
  }

  return (
    // The browser's own email check is stricter than the server's, so validateStep1 decides.
    <form ref={form} noValidate onSubmit={next} className="space-y-4">
      <h2 ref={heading} tabIndex={-1} className="outline-none">
        <span className="block text-sm font-medium text-gray-700">
          Step {step} of {LAST_STEP}
        </span>
        <span className="text-xl font-bold">{STEP_TITLES[step]}</span>
      </h2>

      {/* Off-screen, not display: none, which many bots skip. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={fields.website}
            onChange={(event) =>
              dispatch({
                type: "set",
                field: "website",
                value: event.target.value,
              })
            }
          />
        </label>
      </div>

      {step === 1 ? (
        <LocationContactFields
          fields={fields}
          errors={errors}
          dispatch={dispatch}
        />
      ) : step === 2 ? (
        <IssueFields
          categories={categories}
          fields={fields}
          errors={errors}
          dispatch={dispatch}
          // A new category's questions shouldn't open already marked wrong.
          onCategoryChange={() => setShowErrors(false)}
        />
      ) : (
        <DetailsStep
          fields={fields}
          errors={errors}
          requireEmergencyAck={requireEmergencyAck}
          photos={photos}
          dispatch={dispatch}
        />
      )}

      {submission.error && (
        <Alert variant="error">
          {failureMessage(submission.error)} <EmergencyLink />.
        </Alert>
      )}

      <div className="flex gap-3">
        {step > 1 && (
          <Button
            className="flex-1"
            disabled={submission.isPending}
            onClick={() => move("back")}
          >
            Back
          </Button>
        )}
        <Button
          type="submit"
          className="flex-1"
          loading={preparing || submission.isPending}
        >
          {preparing
            ? "Preparing photos"
            : submission.isPending
              ? "Sending"
              : step < LAST_STEP
                ? "Next"
                : submission.error && submission.error.status !== 422
                  ? "Try again"
                  : "Submit"}
        </Button>
      </div>
      {step === LAST_STEP && (
        <p className="text-sm text-gray-700">{siteConfig.privacyNotice}</p>
      )}
    </form>
  );
}
