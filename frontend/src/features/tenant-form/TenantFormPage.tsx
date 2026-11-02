import { useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { flushSync } from "react-dom";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { Button } from "../../shared/ui/Button";
import { Alert, Spinner } from "../../shared/ui/Feedback";
import { formReducer, initialFormState, LAST_STEP } from "./formState";
import { LoadError } from "./LoadError";
import { LocationContactStep } from "./LocationContactStep";
import { usePublicConfig } from "./usePublicConfig";
import { validateStep1 } from "./validation";

const STEP_TITLES: Record<number, string> = {
  1: "Your home and contact details",
  2: "The problem",
  3: "Details and access",
};

export function TenantFormPage() {
  const config = usePublicConfig();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-2xl font-bold">Report a maintenance problem</h1>
      <Alert variant="warning">
        If anyone is in danger, or there is gas, fire, or flooding, don't use
        this form. Call <EmergencyLink />.
      </Alert>
      {config.data ? (
        <TenantForm />
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

function TenantForm() {
  const [{ step, fields }, dispatch] = useReducer(
    formReducer,
    initialFormState,
  );
  const [showErrors, setShowErrors] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const stepErrors = step === 1 ? validateStep1(fields) : {};

  function move(type: "next" | "back") {
    // Flushed so focus lands after the new step is on the page.
    flushSync(() => {
      setShowErrors(false);
      dispatch({ type });
    });
    heading.current?.focus();
    window.scrollTo(0, 0);
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(stepErrors).length === 0) return move("next");
    flushSync(() => setShowErrors(true));
    // Page order is field order, so the first match is the first invalid field.
    form.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
      ?.focus();
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

      {step === 1 ? (
        <LocationContactStep
          fields={fields}
          errors={showErrors ? stepErrors : {}}
          dispatch={dispatch}
        />
      ) : (
        <p>This step isn't ready yet.</p>
      )}

      <div className="flex gap-3">
        {step > 1 && (
          <Button className="flex-1" onClick={() => move("back")}>
            Back
          </Button>
        )}
        {step < LAST_STEP && (
          <Button type="submit" className="flex-1">
            Next
          </Button>
        )}
      </div>
    </form>
  );
}
