import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const BIOME_SOURCE = fileURLToPath(
  new URL("../src/game/models/biomes.ts", import.meta.url),
);

/**
 * Build tools read the authoritative TypeScript declaration instead of
 * maintaining a second biome list. The AST walk fails closed when the
 * registry stops being a direct object declaration.
 */
export function loadBiomeKeys(sourcePath = BIOME_SOURCE) {
  const sourceText = readFileSync(sourcePath, "utf8");
  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let registry = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "BIOME_DEFINITIONS"
      && node.initializer
    ) {
      const initializer = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
      if (initializer && ts.isObjectLiteralExpression(initializer)) registry = initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!registry) throw new Error(`Could not resolve BIOME_DEFINITIONS in ${sourcePath}`);
  const keys = registry.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !property.name) {
      throw new Error("BIOME_DEFINITIONS must contain direct property assignments");
    }
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text;
    }
    throw new Error("BIOME_DEFINITIONS keys must be identifiers or string literals");
  });
  if (keys.length === 0 || new Set(keys).size !== keys.length) {
    throw new Error("BIOME_DEFINITIONS must contain unique biome keys");
  }
  return Object.freeze(keys);
}
