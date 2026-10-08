import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartupPhaseObserver, OPERATIONS, LEDGER_BASENAME, MAX_ROWS, MAX_BYTES } from "./observer.mjs";

function fixture(options = {}) {
  let now = 100;
  const observer = createStartupPhaseObserver({ clock: () => now, ...options });
  observer.start(now);
  return { observer, set: (value) => { now = value; }, run() {
    OPERATIONS.forEach((operation, i) => {
      now = 101 + i * 10; observer.enter(operation);
      now += i + 1; observer.returned(operation);
    });
    observer.finish(50);
    return observer;
  } };
}
function directory(fn) {
  const dir = mkdtempSync(join(tmpdir(), "zk682-startup-observer-"));
  try { return fn(dir, join(dir, LEDGER_BASENAME)); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("normal twelve primitive rows use existing total boundary and frozen copies", () => {
  const f = fixture(); const o = f.run(); const s = o.freeze();
  assert.equal(s.records.length, MAX_ROWS);
  assert.deepEqual(s.records[0], { operation: "total", kind: "start", offsetMs: 0 });
  assert.deepEqual(s.records.at(-1), { operation: "total", kind: "return", offsetMs: 50 });
  OPERATIONS.forEach((operation, i) => {
    assert.equal(s.records[1 + i * 2].operation, operation);
    assert.equal(s.records[2 + i * 2].offsetMs - s.records[1 + i * 2].offsetMs, i + 1);
  });
  assert.equal(s.observerInvalid, false);
  assert.equal(s.firstFailedOperation, null);
  assert.equal(s.status, "returned");
  assert.throws(() => { s.records[1].offsetMs = 99; }, TypeError);
  assert.throws(() => { s.records.push({}); }, TypeError);
  f.set(200); o.rejected(new Error("late")); o.enter(OPERATIONS[0]);
  assert.strictEqual(o.freeze(), s);
});

test("each boundary records one falsy-safe error and one terminal, never unreached rows", () => {
  for (let failed = 0; failed < OPERATIONS.length; failed += 1) {
    for (const value of [false, null, undefined, new Error("primary")]) {
      const f = fixture(); const o = f.observer;
      for (let i = 0; i <= failed; i += 1) {
        f.set(101 + i * 10); o.enter(OPERATIONS[i]);
        f.set(102 + i * 10);
        if (i < failed) o.returned(OPERATIONS[i]);
        else { o.failed(OPERATIONS[i], value); o.failed(OPERATIONS[i], "secondary"); }
      }
      f.set(103 + failed * 10); o.rejected(value);
      const s = o.freeze();
      assert.equal(s.records.length, 2 * failed + 4);
      assert.equal(s.records.filter((r) => r.kind === "error").length, 2);
      assert.equal(s.firstFailedOperation, OPERATIONS[failed]);
      assert.equal(s.firstErrorPresent, true);
      assert.equal(s.firstErrorKind, value === null ? "null" : typeof value);
      assert.equal(s.observerInvalid, false);
      assert.equal(s.records.at(-1).kind, "error");
      assert.equal(s.records.some((r) => OPERATIONS.indexOf(r.operation) > failed), false);
    }
  }
});

test("observer never reads thrown object properties", () => {
  const hostile = new Proxy({}, { get() { throw new Error("property read"); } });
  const f = fixture(); f.observer.enter(OPERATIONS[0]);
  assert.doesNotThrow(() => f.observer.failed(OPERATIONS[0], hostile));
  f.observer.rejected(hostile);
  assert.equal(f.observer.freeze().firstErrorKind, "object");
});

test("throwing, nonfinite and backwards clocks are sticky invalid without escaping", () => {
  for (const clock of [() => { throw false; }, () => NaN, () => Infinity, () => 99]) {
    const f = fixture({ clock });
    assert.doesNotThrow(() => { f.observer.enter(OPERATIONS[0]); f.observer.failed(OPERATIONS[0], null); f.observer.rejected(undefined); });
    assert.equal(f.observer.freeze().observerInvalid, true);
    assert.ok(f.observer.freeze().records.length <= MAX_ROWS);
  }
  const f = fixture(); f.observer.enter(OPERATIONS[0]); f.set(99); f.observer.returned(OPERATIONS[0]);
  f.set(200); f.observer.rejected(false);
  assert.equal(f.observer.freeze().observerInvalid, true);
});

test("wrong order, duplicate boundaries and missing start/terminal fail closed", () => {
  const f = fixture(); f.observer.enter(OPERATIONS[1]); f.run();
  assert.equal(f.observer.freeze().observerInvalid, true);
  const o = createStartupPhaseObserver(); o.enter(OPERATIONS[0]);
  assert.equal(o.freeze().observerInvalid, true);
  const early = fixture().observer.freeze();
  assert.equal(early.terminal, false); assert.equal(early.status, "UNKNOWN");
  assert.deepEqual(early.records.map((r) => r.operation), ["total"]);
});

test("disabled observer performs no clock or publication work", () => {
  let reads = 0;
  const f = fixture({ enabled: false, clock: () => { reads += 1; throw false; } });
  f.run(); f.observer.rejected(null);
  directory((dir, path) => {
    assert.equal(f.observer.publish(path).published, false);
    assert.equal(existsSync(path), false);
  });
  assert.equal(reads, 0);
});

test("actual wx publication is bounded and exactly once with frozen provenance", () => directory((dir, path) => {
  const o = fixture().run(); const result = o.publish(path);
  assert.deepEqual(result, { published: true, observerInvalid: false, reason: null });
  const text = readFileSync(path, "utf8");
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES);
  assert.deepEqual(JSON.parse(text), o.freeze());
  assert.strictEqual(o.publish(path), result);
  assert.equal(readFileSync(path, "utf8"), text);
  assert.equal(statSync(path).mode & 0o777, 0o600);
}));

test("actual preexisting file and symlink retain all foreign bytes", () => directory((dir, path) => {
  writeFileSync(path, "foreign");
  const o = fixture().run(); assert.equal(o.publish(path).published, false);
  assert.equal(readFileSync(path, "utf8"), "foreign");
  rmSync(path); const foreign = join(dir, "foreign"); writeFileSync(foreign, "target"); symlinkSync(foreign, path);
  const second = fixture().run(); assert.equal(second.publish(path).published, false);
  assert.equal(readFileSync(foreign, "utf8"), "target");
}));

test("publication errors are typed, bounded, frozen and cannot change the producer primary", () => directory((dir, path) => {
  const primary = false; const f = fixture(); f.observer.enter(OPERATIONS[0]); f.observer.rejected(primary);
  let thrown;
  try { f.observer.publish(path, { write() { throw null; } }); throw primary; } catch (error) { thrown = error; }
  assert.strictEqual(thrown, primary);
  assert.equal(f.observer.freeze().status, "rejected");
  assert.equal(f.observer.publish(path).observerInvalid, true);
  assert.equal(existsSync(path), false);
}));

test("cyclic, substituted, oversized and UTF8 serializers cannot publish false facts", () => directory((dir, path) => {
  const cycle = {}; cycle.self = cycle;
  const serializers = [
    () => JSON.stringify(cycle), () => "{}", () => "x".repeat(MAX_BYTES),
    () => "é".repeat(MAX_BYTES / 2), () => { throw undefined; }, () => ({ toString() { throw false; } }),
  ];
  for (const serialize of serializers) {
    const o = fixture().run(); assert.doesNotThrow(() => o.publish(path, { serialize }));
    assert.equal(o.publish(path).observerInvalid, true); assert.equal(existsSync(path), false);
  }
}));

test("hostile serializer mutation and reentrant publication cannot mutate frozen observations", () => directory((dir, path) => {
  const o = fixture().run(); let writes = 0;
  const result = o.publish(path, { serialize(snapshot) {
    assert.throws(() => { snapshot.records[1].offsetMs = 4; }, TypeError);
    assert.equal(o.publish(path).reason, "publication-in-progress");
    o.enter(OPERATIONS[0]); o.rejected(false);
    return JSON.stringify(snapshot);
  }, write(filename, data, options) { writes += 1; writeFileSync(filename, data, options); } });
  assert.equal(writes, 1); assert.equal(result.published, true);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).records.length, MAX_ROWS);
}));

test("invalid path and incomplete phase produce missing/invalid evidence, never fabricated completion", () => directory((dir, path) => {
  assert.equal(fixture().run().publish(join(dir, "other.json")).reason, "invalid-path");
  const o = fixture().observer;
  assert.equal(o.publish(path).reason, "missing-terminal");
  assert.equal(existsSync(path), false);
  assert.equal(o.freeze().terminal, false);
}));


test("reentrant hostile clock mutation is sticky invalid and cannot fabricate accepted phase order", () => {
  let o;
  o = createStartupPhaseObserver({ clock() { o.rejected(false); return 101; } });
  o.start(100);
  assert.doesNotThrow(() => o.enter(OPERATIONS[0]));
  assert.doesNotThrow(() => o.rejected(undefined));
  const snapshot = o.freeze();
  assert.equal(snapshot.observerInvalid, true);
  assert.equal(snapshot.records.length <= MAX_ROWS, true);
  assert.equal(snapshot.firstErrorKind, "undefined");
});
