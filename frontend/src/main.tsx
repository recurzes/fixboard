import { reactErrorHandler } from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ConfigError } from "./app/ConfigError";
import "./index.css";
import { config, missingEnv } from "./shared/lib/config";
import { initSentry } from "./shared/lib/sentry";

initSentry(config.sentryDsn);

// Replacing React's handlers also replaces its console output, so log here too.
const reportError = reactErrorHandler((error) => console.error(error));

createRoot(document.getElementById("root")!, {
  onCaughtError: reportError,
  onUncaughtError: reportError,
}).render(
  <StrictMode>
    {missingEnv.length > 0 ? <ConfigError missing={missingEnv} /> : <App />}
  </StrictMode>,
);
