import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { flushSync } from "react-dom";
import { siteConfig } from "../../shared/lib/siteConfig";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { Button } from "../../shared/ui/Button";
import { Alert, Spinner } from "../../shared/ui/Feedback";
import { DetailsStep } from "./DetailsStep";
import { formReducer, initialFormState, LAST_STEP } from "./formState";
import { IssueStep } from "./IssueStep";
import { LoadError } from "./LoadError";
import { LocationContactStep } from "./LocationContactStep";
import { usePhotos } from "./photos";
import { usePublicConfig } from "./usePublicConfig";
import type { Category } from "./usePublicConfig";
import { validateStep1, validateStep2, validateStep3 } from "./validation";

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
        <TenantForm
          categories={config.data.categories}
          requireEmergencyAck={config.data.require_emergency_ack}
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
}: {
  categories: Category[];
  requireEmergencyAck: boolean;
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

  // Drafts aren't saved, so this prompt is all that protects typed data.
  // Leaving for the confirmation page unmounts this, which removes the prompt.
  const hasData =
    photos.items.length > 0 ||
    JSON.stringify(fields) !== JSON.stringify(initialFormState.fields);
  useEffect(() => {
    if (!hasData) return;
    const warn = (event: BeforeUnloadEvent) => {
      // Chromium fires this for tel: links too, and a call must never wait on a prompt.
      // shortcut: relies on a clicked link taking focus, which desktop Safari skips, so it still prompts there.
      if (document.activeElement?.matches('a[href^="tel:"]')) return;
      event.preventDefault();
      // Chrome and Edge before 119 ignore preventDefault here.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasData]);

  const stepErrors: Record<string, string> =
    step === 1
      ? validateStep1(fields)
      : step === 2
        ? validateStep2(fields, categories)
        : validateStep3(fields, requireEmergencyAck);

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
    if (Object.keys(stepErrors).length === 0) {
      // shortcut: a valid Submit does nothing yet, F51 sends the request.
      if (step < LAST_STEP) move("next");
      return;
    }
    flushSync(() => setShowErrors(true));
    // Page order is field order, so the first match is the first invalid field.
    const invalid = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(:disabled)',
    );
    // A radio group's fieldset can't take focus, so its first radio does.
    (invalid?.querySelector("input") ?? invalid)?.focus();
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
      ) : step === 2 ? (
        <IssueStep
          categories={categories}
          fields={fields}
          errors={showErrors ? stepErrors : {}}
          dispatch={dispatch}
          // A new category's questions shouldn't open already marked wrong.
          onCategoryChange={() => setShowErrors(false)}
        />
      ) : (
        <DetailsStep
          fields={fields}
          errors={showErrors ? stepErrors : {}}
          requireEmergencyAck={requireEmergencyAck}
          photos={photos}
          dispatch={dispatch}
        />
      )}

      <div className="flex gap-3">
        {step > 1 && (
          <Button className="flex-1" onClick={() => move("back")}>
            Back
          </Button>
        )}
        <Button type="submit" className="flex-1" loading={preparing}>
          {preparing
            ? "Preparing photos"
            : step < LAST_STEP
              ? "Next"
              : "Submit"}
        </Button>
      </div>
      {step === LAST_STEP && (
        <p className="text-sm text-gray-700">{siteConfig.privacyNotice}</p>
      )}
    </form>
  );
}
