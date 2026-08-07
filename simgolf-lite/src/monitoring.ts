import type { ErrorInfo } from "react";

type CaptureAppError = (error: Error, info: ErrorInfo) => string | undefined;
let captureAppError: CaptureAppError | undefined;
const monitoringInitialization = import.meta.env.PROD && (
  import.meta.env.VITE_SENTRY_DSN || import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN
)
  ? import("./monitoringRuntime")
      .then(({ initializeMonitoringRuntime }) => (captureAppError = initializeMonitoringRuntime()))
      .catch(() => undefined)
  : Promise.resolve(undefined);

export function reportAppError(error: Error, info: ErrorInfo): string | undefined {
  if (captureAppError) return captureAppError(error, info);
  void monitoringInitialization.then((capture) => capture?.(error, info));
  return undefined;
}
