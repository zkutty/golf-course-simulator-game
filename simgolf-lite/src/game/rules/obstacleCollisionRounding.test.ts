import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Exercise the real private helper without exporting a production test API or
// copying its implementation. The original expression remains the oracle.
const source = ts.createSourceFile("obstacleCollision.ts", readFileSync(new URL("./obstacleCollision.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "rounded");
if (!declaration) throw new Error("Missing collision rounding helper");
const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const rounded = runInNewContext(`${compiled}; rounded;`, { Math, Number }) as (value: unknown) => number;
const original = (value: unknown) => Number((value as number).toFixed(6));
const view = new DataView(new ArrayBuffer(8));
function fromBits(bits: bigint): number { view.setBigUint64(0, bits); return view.getFloat64(0); }
function bits(value: number): bigint { view.setFloat64(0, value); return view.getBigUint64(0); }
function nextUp(value: number): number {
  if (value === 0) return Number.MIN_VALUE;
  return fromBits(bits(value) + (value > 0 ? 1n : -1n));
}
function compare(values: Iterable<number>): void {
  for (const value of values) {
    if (!Object.is(rounded(value), original(value))) throw new Error(`Rounding differs for ${value}, bits ${bits(value).toString(16)}`);
  }
}

describe("exact guarded six-decimal collision rounding", () => {
  it("preserves signed zero, half boundaries, subnormals, large and nonfinite values", () => {
    compare([0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, -(2 ** -1022),
      5e-7, -5e-7, .0078125, -.0078125, 999999.9999995, -999999.9999995,
      nextUp(1_000_000), 1_000_000, -1_000_000, -nextUp(1_000_000),
      1e21, -1e21, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN]);
    expect(Object.is(rounded(-0), 0)).toBe(true);
    expect(Object.is(rounded(-Number.MIN_VALUE), -0)).toBe(true);
    expect(Object.is(rounded(5e-7), 0)).toBe(true);
    expect(rounded(-.0078125)).toBe(-.007813);
  });

  it("matches original bits across seeded raw doubles and both sides of decimal halves", () => {
    let seed = 0x7391397;
    const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const values: number[] = [];
    for (let index = 0; index < 10_000; index++) {
      values.push((random() / 2 ** 32 - .5) * 2_000_000);
      values.push(fromBits((BigInt(random()) << 32n) | BigInt(random())));
      const n = (random() * 256 + (random() & 255)) % 1_000_000_000_000;
      const half = (n + .5) / 1_000_000;
      const below = -nextUp(-half);
      values.push(half, -half, nextUp(half), -nextUp(half), below, -below);
    }
    compare(values);
  });

  it("preserves original non-Number behavior without implicit numeric coercion", () => {
    const boxed = Object(1.23456789);
    boxed.valueOf = () => { throw new Error("Numeric coercion is forbidden"); };
    const values = ["1.23456789", true, false, null, undefined, 3n, Symbol("number"), boxed,
      { valueOf: () => 1.1, toFixed: () => "9.875000" },
      { valueOf: () => { throw new Error("Numeric coercion is forbidden"); }, toFixed: () => "-0.000000" },
      { toFixed: () => { throw new RangeError("custom fixed"); } }];
    const observe = (fn: (value: unknown) => number, value: unknown) => {
      try { return { ok: true as const, value: fn(value) }; }
      catch (error) { return { ok: false as const, name: (error as Error).name, message: (error as Error).message }; }
    };
    for (const value of values) {
      const expected = observe(original, value), actual = observe(rounded, value);
      expect(actual.ok).toBe(expected.ok);
      if (actual.ok && expected.ok) expect(Object.is(actual.value, expected.value)).toBe(true);
      else expect(actual).toEqual(expected);
    }
  });
});
