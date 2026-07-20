import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

const files = ["src/App.tsx"];
function collect(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) collect(path);
    else if ([".tsx", ".jsx"].includes(extname(path)) && !path.endsWith(".test.tsx")) files.push(path);
  }
}
collect("src/ui");
const visibleAttributes = new Set(["aria-label", "placeholder", "title", "alt", "label", "hint"]);
const violations = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, value) => violations.push(`${file}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}: hardcoded player-facing string ${JSON.stringify(value.trim())}`);
  const visit = (node) => {
    if (ts.isJsxText(node) && node.text.trim() && /[A-Za-z]/.test(node.text)) report(node, node.text);
    const parentTag = node.parent && ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText(parsed) : "";
    if (ts.isJsxExpression(node) && node.expression && parentTag !== "style" && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expression = node.expression;
      const text = ts.isTemplateExpression(expression)
        ? [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join("")
        : ts.isStringLiteralLike(expression) ? expression.text : "";
      if (/[A-Za-z]/.test(text)) report(node, text);
    }
    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text) && node.initializer) {
      if (ts.isStringLiteral(node.initializer) && /[A-Za-z]/.test(node.initializer.text)) report(node, node.initializer.text);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const expression = node.initializer.expression;
        const text = ts.isTemplateExpression(expression)
          ? [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join("")
          : ts.isStringLiteralLike(expression) ? expression.text : "";
        if (/[A-Za-z]/.test(text)) report(node, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}
if (violations.length) { console.error(["i18n extraction guard failed:", ...violations, "Add a typed catalog key and render it with t()."].join("\n")); process.exit(1); }
console.log(`i18n extraction guard passed (${files.length} UI files)`);

const contentFiles = ["src/game/onboarding/tutorial.ts", "src/game/advisor/advisor.ts", "src/game/scenarios/scenarios.ts", "src/ui/help/golfopediaData.ts"];
const contentFields = new Set(["title", "body", "blurb", "label", "description", "summary", "details", "eyebrow", "actionLabel"]);
const contentViolations = [];
for (const file of contentFiles) {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && contentFields.has(node.name.getText(parsed).replaceAll('"', ""))) {
      const literals = [];
      if (ts.isStringLiteralLike(node.initializer) && /[A-Za-z]/.test(node.initializer.text) && !/^[a-z][A-Za-z0-9.]+$/.test(node.initializer.text)) literals.push(node.initializer);
      if (ts.isArrayLiteralExpression(node.initializer)) {
        for (const element of node.initializer.elements) if (ts.isStringLiteralLike(element) && /[A-Za-z]/.test(element.text)) literals.push(element);
      }
      for (const literal of literals) contentViolations.push(`${file}:${parsed.getLineAndCharacterOfPosition(literal.getStart(parsed)).line + 1}: content must come from the catalog: ${JSON.stringify(literal.text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}
if (contentViolations.length) { console.error(["i18n content guard failed:", ...contentViolations].join("\n")); process.exit(1); }
console.log(`i18n content guard passed (${contentFiles.length} authored-content files)`);
