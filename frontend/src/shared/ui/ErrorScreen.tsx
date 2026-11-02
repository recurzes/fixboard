import { siteConfig } from "../lib/siteConfig";
import { Alert } from "./Feedback";

// A backend 500 has no CORS header and looks like an outage, so this wording covers both.
export function ErrorScreen() {
  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold">We can't load this page right now</h1>
      <p className="my-4">
        Something went wrong on our side, or our system can't be reached. Please
        try again in a few minutes.
      </p>
      <Alert variant="warning">
        If this is an emergency or you need help now, call{" "}
        <a
          href={`tel:${siteConfig.emergencyNumber.replace(/\D/g, "")}`}
          className="font-semibold whitespace-nowrap underline"
        >
          {siteConfig.emergencyNumber}
        </a>
        .
      </Alert>
    </main>
  );
}
