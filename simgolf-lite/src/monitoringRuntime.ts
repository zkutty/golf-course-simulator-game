import type { ErrorInfo } from "react";
import {
  normalizeUnhandledRejection,
  type NormalizedUnhandledRejection,
  type RejectionShape,
} from "./rejectionDiagnostics";

type CaptureAppError = (error: Error, info: ErrorInfo) => string | undefined;
type CaptureUnhandledRejection = (rejection: NormalizedUnhandledRejection) => string | undefined;
let captureSentryError: CaptureAppError | undefined;
let captureSentryUnhandledRejection: CaptureUnhandledRejection | undefined;
let sentryInitialization: Promise<void> | undefined;
const pendingSentryErrors: Array<{ error: Error; info: ErrorInfo }> = [];
const pendingUnhandledRejections = new Map<RejectionShape, NormalizedUnhandledRejection>();
let unhandledRejectionCaptureInstalled = false;

/** Keep a single privacy-normalized record for each of the five safe shapes. */
export function coalescePendingUnhandledRejection(
  pending: Map<RejectionShape, NormalizedUnhandledRejection>,
  rejection: NormalizedUnhandledRejection,
): void {
  pending.set(rejection.shape, rejection)
}

export function cloudflareBeaconConfiguration(token: string): { token: string; spa: true } {
  return { token, spa: true };
}

export function monitoringHasSentryDsn(production: boolean, dsn: string | undefined): boolean {
  return production && Boolean(dsn?.trim());
}

function configuredSentryDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  return monitoringHasSentryDsn(import.meta.env.PROD, dsn) ? dsn : undefined;
}

function installCloudflareWebAnalytics(): void {
  const token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN?.trim();
  if (!import.meta.env.PROD || !token || document.querySelector("script[data-cf-beacon]")) return;
  const beacon = document.createElement("script");
  beacon.defer = true;
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.dataset.cfBeacon = JSON.stringify(cloudflareBeaconConfiguration(token));
  document.head.append(beacon);
}

function initializeSentry(dsn: string): Promise<void> {
  if (captureSentryError) return Promise.resolve();
  if (sentryInitialization) return sentryInitialization;
  sentryInitialization = import("./sentryRuntime").then(({ captureNormalizedUnhandledRejection, initializeSentryRuntime }) => {
    captureSentryError = initializeSentryRuntime(dsn);
    captureSentryUnhandledRejection = captureNormalizedUnhandledRejection;
    for (const { error, info } of pendingSentryErrors.splice(0)) captureSentryError(error, info);
    for (const rejection of pendingUnhandledRejections.values()) captureSentryUnhandledRejection(rejection);
    pendingUnhandledRejections.clear();
  }).catch(() => {
    sentryInitialization = undefined;
  });
  return sentryInitialization;
}

function installUnhandledRejectionCapture(dsn: string): void {
  if (unhandledRejectionCaptureInstalled || typeof window === 'undefined') return;
  unhandledRejectionCaptureInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const rejection = normalizeUnhandledRejection(event.reason);
    if (captureSentryUnhandledRejection) {
      captureSentryUnhandledRejection(rejection);
      return;
    }
    // One fixed record per shape bounds memory and retry noise even when SDK
    // initialization repeatedly fails. It contains no rejected value.
    coalescePendingUnhandledRejection(pendingUnhandledRejections, rejection);
    void initializeSentry(dsn);
  });
}

export function initializeMonitoringRuntime(): CaptureAppError {
  installCloudflareWebAnalytics();
  const dsn = configuredSentryDsn();
  if (dsn) {
    installUnhandledRejectionCapture(dsn);
    void initializeSentry(dsn);
  }
  return (error, info) => {
    if (!dsn) return undefined;
    if (captureSentryError) return captureSentryError(error, info);
    pendingSentryErrors.push({ error, info });
    void initializeSentry(dsn);
    return undefined;
  };
}
