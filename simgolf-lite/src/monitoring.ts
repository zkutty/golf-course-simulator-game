import type { ErrorInfo } from "react";
import { initializeMonitoringRuntime } from "./monitoringRuntime";

const captureAppError = initializeMonitoringRuntime();

export function reportAppError(error: Error, info: ErrorInfo): string | undefined {
  return captureAppError(error, info);
}
