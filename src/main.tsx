import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logError } from "./lib/errorLogger";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
  });
}

window.addEventListener("unhandledrejection", (event) => {
  logError(event.reason, { module: "app", action: "unhandledrejection" });
});

window.addEventListener("error", (event) => {
  logError(event.error ?? event.message, {
    module: "app",
    action: "window.error",
    extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
  });
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
