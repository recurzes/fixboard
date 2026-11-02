import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { apiFetch } from "../../../shared/api/client";
import type { ApiError } from "../../../shared/api/client";
import {
  DescriptionField,
  EntryFields,
} from "../../../shared/form/DetailsFields";
import { formReducer, initialFormState } from "../../../shared/form/formState";
import type { FormFields } from "../../../shared/form/formState";
import { IssueFields } from "../../../shared/form/IssueFields";
import { LoadError } from "../../../shared/form/LoadError";
import { LocationContactFields } from "../../../shared/form/LocationContactFields";
import { usePublicConfig } from "../../../shared/form/usePublicConfig";
import type { Category } from "../../../shared/form/usePublicConfig";
import {
  validateStep1,
  validateStep2,
  validateStep3,
} from "../../../shared/form/validation";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/Choice";
import { Alert, Spinner } from "../../../shared/ui/Feedback";
import { placeFieldErrors } from "../../tenant-form/submission";
import { SOURCE_LABELS } from "./useRequest";
import type { RequestDetail } from "./useRequest";

// The staff endpoint refuses tenant_form.
const SOURCES = (["phone", "text", "in_person"] as const).map((value) => ({
  value,
  label: SOURCE_LABELS[value],
}));

function validate(fields: FormFields, source: string, categories: Category[]) {
  const errors: Record<string, string> = {
    ...validateStep1(fields),
    ...validateStep2(fields, categories),
    // No "not an emergency" tick: that is the tenant's own acknowledgement.
    ...validateStep3(fields, false),
  };
  if (errors.tenant_name) errors.tenant_name = "Enter the tenant's name";
  if (!source) errors.source = "Choose how the request came in";
  return errors;
}

export function LogRequestPage() {
  const config = usePublicConfig();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Log request</h1>
      {config.data ? (
        <LogRequestForm categories={config.data.categories} />
      ) : config.isError ? (
        <LoadError
          what="the form"
          retrying={config.isFetching}
          onRetry={() => void config.refetch()}
        />
      ) : (
        <Spinner label="Loading the form" />
      )}
    </div>
  );
}

/** The tenant form's sections on one page, plus Source. No honeypot, emergency tick, privacy notice, self-check, or photos. */
function LogRequestForm({ categories }: { categories: Category[] }) {
  const [{ fields }, dispatch] = useReducer(formReducer, initialFormState);
  const [source, setSource] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [refused, setRefused] = useState<{
    errors: Record<string, string>;
    fields: FormFields;
  } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // The route has no idempotency key, and isPending only updates on the next render, which a fast double click can beat.
  const sending = useRef(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const submission = useMutation<RequestDetail, ApiError>({
    mutationFn: () =>
      apiFetch<RequestDetail>("/api/staff/requests", {
        method: "POST",
        body: {
          unit_id: Number(fields.unit_id),
          tenant_name: fields.tenant_name,
          phone: fields.phone,
          email: fields.email,
          category: fields.category,
          description: fields.description,
          entry_permission: fields.entry_permission,
          entry_notes: fields.entry_notes.trim() || null,
          followup_answers: fields.followup_answers,
          source,
        },
      }),
    onSuccess: (created) => {
      queryClient.setQueryData(
        ["staff", "request", String(created.id)],
        created,
      );
      void queryClient.invalidateQueries({ queryKey: ["staff", "requests"] });
      void queryClient.invalidateQueries({ queryKey: ["staff", "summary"] });
      void navigate(`/staff/requests/${created.id}`, {
        state: { logged: true },
      });
    },
    onError: (error) => {
      if (error.status !== 422) return;
      flushSync(() => {
        setShowErrors(false);
        setRefused({ errors: placeFieldErrors(error.fields).errors, fields });
      });
      focusFirstInvalid();
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  const invalid = validate(fields, source, categories);
  const errors = {
    ...(refused?.fields === fields ? refused.errors : {}),
    ...(showErrors ? invalid : {}),
  };

  function focusFirstInvalid() {
    const first = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(:disabled)',
    );
    // A radio group's fieldset can't take focus, so its first radio does.
    (first?.querySelector("input") ?? first)?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(invalid).length > 0) {
      flushSync(() => setShowErrors(true));
      focusFirstInvalid();
      return;
    }
    if (sending.current) return;
    sending.current = true;
    submission.mutate();
  }

  return (
    <form ref={form} noValidate onSubmit={submit} className="space-y-4">
      <RadioGroup
        label="How did it come in? (required)"
        options={SOURCES}
        value={source}
        error={errors.source}
        onChange={setSource}
      />
      <LocationContactFields
        fields={fields}
        errors={errors}
        dispatch={dispatch}
        staff
      />
      <IssueFields
        categories={categories}
        fields={fields}
        errors={errors}
        dispatch={dispatch}
        // A new category's questions shouldn't open already marked wrong.
        onCategoryChange={() => setShowErrors(false)}
        staff
      />
      <DescriptionField fields={fields} errors={errors} dispatch={dispatch} />
      <EntryFields fields={fields} errors={errors} dispatch={dispatch} />

      {submission.error && (
        <Alert variant="error">
          {submission.error.status === 422
            ? "The request wasn't logged. Check the marked fields."
            : "The request wasn't logged. Try again."}
        </Alert>
      )}
      <Button type="submit" loading={submission.isPending}>
        {submission.isPending ? "Logging" : "Log request"}
      </Button>
    </form>
  );
}
