import type { ErrorInfo } from "react";

type CaptureAppError = (error: Error, info: ErrorInfo) => string | undefined;
let captureSentryError: CaptureAppError | undefined;
let sentryInitialization: Promise<void> | undefined;
const pendingSentryErrors: Array<{ error: Error; info: ErrorInfo }> = [];

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
  sentryInitialization = import("./sentryRuntime").then(({ initializeSentryRuntime }) => {
    captureSentryError = initializeSentryRuntime(dsn);
    for (const { error, info } of pendingSentryErrors.splice(0)) captureSentryError(error, info);
  }).catch(() => {
    sentryInitialization = undefined;
  });
  return sentryInitialization;
}

export function initializeMonitoringRuntime(): CaptureAppError {
  installCloudflareWebAnalytics();
  const dsn = configuredSentryDsn();
  if (dsn) void initializeSentry(dsn);
  return (error, info) => {
    if (!dsn) return undefined;
    if (captureSentryError) return captureSentryError(error, info);
    pendingSentryErrors.push({ error, info });
    void initializeSentry(dsn);
    return undefined;
  };
}
