import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validatePackageText } from "./packageFormat";

describe("M43 package parser fuzz corpus", () => {
  it("never throws for bounded arbitrary text", async () => {
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 2_000 }), async (text) => {
      const result = await validatePackageText(text);
      expect(["compatible", "migratable", "unsupported", "corrupt"]).toContain(result.status);
    }), { numRuns: 100 });
  });
});
