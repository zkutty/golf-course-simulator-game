declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    BUG_REPORT_OPERATOR_SECRET: string;
    LINEAR_API_KEY: string;
    SENTRY_WEBHOOK_SECRET: string;
  }
}
