import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
        environment: "staging",
      },
      miniflare: {
        bindings: {
          LINEAR_API_KEY: "lin_api_integration_test_only",
          SENTRY_WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef",
          BUG_REPORT_OPERATOR_SECRET: "abcdef0123456789abcdef0123456789",
        },
      },
    }),
  ],
  test: {
    include: ["worker/**/*.integration.test.ts"],
  },
});
