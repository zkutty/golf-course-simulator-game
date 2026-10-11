import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

type Options = boolean | { removeView: boolean; releaseGlobalResources: boolean };

function ownedDestroySites() {
  const text = readFileSync(new URL("../src/ui/PixiStage.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("PixiStage.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: { line: number; options: Options }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "destroy"
      && ["app", "appRef.current"].includes(node.expression.expression.getText(source))) {
      const arg = node.arguments[0];
      let options: Options;
      if (arg.kind === ts.SyntaxKind.TrueKeyword) options = true;
      else {
        if (!ts.isObjectLiteralExpression(arg)) throw new Error("Owned renderer destroy options must be explicit literals");
        const values = new Map<string, boolean>();
        for (const property of arg.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)
            || ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(property.initializer.kind)) {
            throw new Error("Owned renderer destroy option is not a boolean literal");
          }
          values.set(property.name.text, property.initializer.kind === ts.SyntaxKind.TrueKeyword);
        }
        if (values.size !== 2 || !values.has("removeView") || !values.has("releaseGlobalResources")) {
          throw new Error("Owned renderer teardown must declare both local and global ownership");
        }
        options = { removeView: values.get("removeView")!, releaseGlobalResources: values.get("releaseGlobalResources")! };
      }
      sites.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, options });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(sites).toHaveLength(6);
  return { sites, sha256: createHash("sha256").update(text).digest("hex") };
}

test("owned Pixi teardown preserves peer batches and rendered pixels at every source site", async ({ context }, testInfo) => {
  const source = ownedDestroySites();
  await testInfo.attach("source-sites", { body: Buffer.from(JSON.stringify(source, null, 2)), contentType: "application/json" });
  const cases = [{ mode: "baseline" as const, line: 0, options: true as Options },
    ...source.sites.map(site => ({ mode: "candidate" as const, ...site }))];
  for (const entry of cases) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    try {
      await page.goto("/e2e/fixtures/pixi-peer-ownership-fixture.html");
      await page.waitForFunction(() => typeof window.runOwnershipControl === "function", undefined, { timeout: 15000 });
      const result = await page.evaluate(({ mode, options }) =>
        window.runOwnershipControl(mode, options), entry);
      await testInfo.attach(`${entry.mode}-${entry.line}`, { body: Buffer.from(JSON.stringify({ ...entry, result, errors }, null, 2)), contentType: "application/json" });
      expect(errors).toEqual([]);
      expect(result.version).toBe("8.14.3");
      expect(result.before.length).toBeGreaterThanOrEqual(2);
      expect(result.before.every((batch: { texturesPresent: boolean }) => batch.texturesPresent)).toBe(true);
      expect(Object.values(result.local).every(Boolean)).toBe(true);
      expect(result.pixelsBefore).toEqual({ red: [255, 0, 0, 255], green: [0, 255, 0, 255] });
      if (entry.mode === "baseline") {
        expect(result.releases).toBe(1);
        expect(result.afterPeer.some((batch: { texturesPresent: boolean }) => !batch.texturesPresent)).toBe(true);
        expect(result.error?.message).toContain("Cannot read properties of null (reading 'clear')");
        expect(result.error?.stack).toMatch(/Batcher.*break|\.break/);
      } else {
        expect(result.releases).toBe(0);
        expect(result.afterPeer.every((batch: { texturesPresent: boolean }) => batch.texturesPresent)).toBe(true);
        expect(result.error).toBeNull();
        expect(result.survivor.canvasConnected).toBe(true);
        expect(result.survivor.alive).toBe(true);
        expect(result.survivor.instructionCount).toBeGreaterThanOrEqual(2);
        expect(result.pixelsAfter).toEqual(result.pixelsBefore);
      }
    } finally { await page.close(); }
  }
});
