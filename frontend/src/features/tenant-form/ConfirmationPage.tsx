import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/ui/Button";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";

export function ConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [reference] = useState(
    (location.state as { reference?: string } | null)?.reference,
  );
  const [copyResult, setCopyResult] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  // The browser keeps router state through a refresh, so holding it only here is what makes a refresh neutral.
  useEffect(() => {
    if (location.state) void navigate("/done", { replace: true, state: null });
  }, [location.state, navigate]);

  // The Submit button that had focus is gone, so a screen reader starts here.
  useEffect(() => heading.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference!);
      setCopyResult("Copied");
    } catch {
      // There's no clipboard without HTTPS, and a browser can refuse.
      setCopyResult("Couldn't copy. Please write it down.");
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-bold outline-none"
      >
        {reference ? "Request received" : "Thank you"}
      </h1>
      {reference ? (
        <>
          <div>
            <p>Your reference number</p>
            <p className="text-4xl font-bold wrap-anywhere">{reference}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void copy()}>Copy number</Button>
            <p role="status">{copyResult}</p>
          </div>
          <h2 className="text-xl font-bold">What happens next</h2>
          <p>
            Our maintenance team will review your request, and will contact you
            if they need anything or to arrange a visit. You won't get emails
            about it, and there's no page to check it on.
          </p>
          <p>
            If you have a question, or it becomes an emergency, call{" "}
            <EmergencyLink /> and give this number.
          </p>
        </>
      ) : (
        <p>If you already sent a request, you're all set.</p>
      )}
    </main>
  );
}
