import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getConfig } = require("app-builder-lib/out/util/config/config.js");
const { FileMatcher, getNodeModuleFileMatcher, excludedExts } = require("app-builder-lib/out/fileMatcher.js");
const { NodeModuleCopyHelper } = require("app-builder-lib/out/util/NodeModuleCopyHelper.js");
const ts = require("typescript");
const appDir = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
const exclusion = "!node_modules/pixi.js/**/*.map";

function moduleMatcher(configuration, moduleName, moduleDir = appDir) {
  const main = getNodeModuleFileMatcher(appDir, appDir, (value) => value, {}, {
    config: configuration, debugLogger: { isEnabled: false },
  });
  return new FileMatcher(moduleDir, path.join(appDir, "node_modules", moduleName), (value) => value, main.patterns);
}

async function collectPixi(configuration) {
  const moduleDir = path.resolve(path.dirname(require.resolve("pixi.js")), "..");
  assert.equal(JSON.parse(readFileSync(path.join(moduleDir, "package.json"), "utf8")).name, "pixi.js");
  const info = { appInfo: { type: "module" }, config: configuration, getWorkspaceRoot: async () => appDir };
  const copier = new NodeModuleCopyHelper(moduleMatcher(configuration, "pixi.js", moduleDir), info);
  // Match the installed copier defaults; .map is deliberately not in them.
  const ignoredExtensions = [".o", ".obj", ...excludedExts.split(",").map((ext) => `.${ext}`), ".pdb", ".dll", ".exe"];
  return copier.collectNodeModules({ name: "pixi.js", dir: moduleDir }, ignoredExtensions, "node_modules/pixi.js");
}

test("the default desktop build selects the Pixi-only map exclusion from package.json", async () => {
  const config = await getConfig(appDir);
  const patterns = config.files.flatMap((entry) => typeof entry === "string" ? [entry] : entry.filter);
  assert.ok(patterns.includes(exclusion));
  assert.deepEqual(packageJson.build.files, ["dist/**/*", "desktop/**/*", "package.json", exclusion]);
});

test("the real installed module collector removes only Pixi maps and preserves its runtime and licence", async () => {
  const beforeConfig = { ...packageJson.build, files: packageJson.build.files.filter((value) => value !== exclusion) };
  const before = await collectPixi(beforeConfig);
  const after = await collectPixi(packageJson.build);
  const kept = new Set(after);
  const removed = before.filter((file) => !kept.has(file));
  assert.ok(removed.length > 0, "original config must actually admit the redundant maps");
  assert.ok(removed.every((file) => file.endsWith(".map")), "no Pixi runtime file may be removed");
  assert.ok(after.every((file) => !file.endsWith(".map")));
  assert.ok(after.every((file) => before.includes(file)));
  for (const suffix of ["lib/index.js", "lib/index.mjs", "package.json", "LICENSE"]) {
    assert.ok(after.some((file) => file.replaceAll("\\", "/").endsWith(suffix)), `${suffix} must remain packaged`);
  }
  const removedBytes = removed.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(removedBytes > 3_404_794, "admitted redundant bytes must exceed the larger observed package excess");
});

test("the module filter preserves other source maps, optional Steam native payload and browser assets", () => {
  const filter = moduleMatcher(packageJson.build, "pixi.js").createFilter();
  const accept = (file) => filter(path.join(appDir, file), { isDirectory: () => false, moduleFullFilePath: file });
  assert.equal(accept("node_modules/pixi.js/lib/index.mjs.map"), false);
  assert.equal(accept("node_modules/pixi.js/dist/pixi.js.map"), false);
  for (const file of ["node_modules/pixi.js/lib/index.mjs", "node_modules/pixi.js/transcoders/basis.wasm", "node_modules/pixi.js/LICENSE", "node_modules/steamworks.js/index.js.map", "node_modules/steamworks.js/build/Release/steamworks.node", "node_modules/react/index.js.map", "dist/assets/pixi-example.js.map"]) {
    assert.equal(accept(file), true, `${file} must not match this exclusion`);
  }
});

test("desktop runtime imports remain local, Node builtins, Electron and optional Steam", () => {
  const bareImports = new Set();
  const dir = path.join(appDir, "desktop");
  for (const name of readdirSync(dir).filter((name) => /\.(mjs|cjs)$/.test(name) && !name.endsWith(".test.mjs"))) {
    const source = ts.createSourceFile(name, readFileSync(path.join(dir, name), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const record = (node) => {
      assert.ok(ts.isStringLiteralLike(node), `${name} has an unclassified runtime import`);
      const specifier = node.text;
      if (!specifier.startsWith(".") && !isBuiltin(specifier)) bareImports.add(specifier);
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) record(node.moduleSpecifier);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) record(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual([...bareImports].sort(), ["electron", "steamworks.js"]);
});
