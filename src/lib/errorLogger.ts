import * as Sentry from "@sentry/react";

type ErrorSeverity = "info" | "warning" | "error" | "fatal";

interface ErrorContext {
  module?: string;
  action?: string;
  userId?: string;
  portalId?: string;
  extra?: Record<string, unknown>;
}

const IS_DEV = import.meta.env.DEV;

function sendToService(error: Error, severity: ErrorSeverity, context: ErrorContext) {
  Sentry.withScope((scope) => {
    scope.setLevel(
      severity === "fatal" ? "fatal"
      : severity === "error" ? "error"
      : severity === "warning" ? "warning"
      : "info"
    );
    if (context.module) scope.setTag("module", context.module);
    if (context.action) scope.setTag("action", context.action);
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.portalId) scope.setTag("portalId", context.portalId);
    if (context.extra) scope.setExtras(context.extra);
    Sentry.captureException(error);
  });
}

export function logError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (IS_DEV) {
    console.error(`[${context.module || "app"}] ${context.action || "error"}:`, err, context.extra);
  }
  sendToService(err, "error", context);
}

export function logWarning(message: string, context: ErrorContext = {}) {
  if (IS_DEV) {
    console.warn(`[${context.module || "app"}] ${message}`, context.extra);
  }
  sendToService(new Error(message), "warning", context);
}

export function logInfo(message: string, context: ErrorContext = {}) {
  if (IS_DEV) {
    console.info(`[${context.module || "app"}] ${message}`);
  }
  sendToService(new Error(message), "info", context);
}
