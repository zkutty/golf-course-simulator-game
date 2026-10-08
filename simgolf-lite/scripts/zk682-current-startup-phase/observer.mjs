import { writeFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET_COMMIT = "0d4307addd412c9653b0ec50af142cead8cac955";
export const DONOR_SHA256 = "329071c2de7c06eeb9739fdb0fa70a87a1953ecf21fdc1f26677b1f504d59de9";
export const LEDGER_BASENAME = "zk682-current-startup-phase-0d4307-diagnostic.json";
export const MAX_ROWS = 12;
export const MAX_BYTES = 8192;
export const OPERATIONS = Object.freeze([
  "fixture-navigation", "fixed-sleep500", "canvas-visible",
  "canvas-nonzero-dimensions", "canvas-bounding-box",
]);

// All observations use the host Node performance clock. Durations include
// transport and scheduling overlap; they do not isolate browser CPU/GPU work.
export function createStartupPhaseObserver({ clock = () => performance.now(), enabled = true } = {}) {
  let origin = null;
  let last = 0;
  let index = 0;
  let active = null;
  let firstFailedOperation = null;
  let firstErrorPresent = false;
  let firstErrorKind = null;
  let terminal = false;
  let status = "UNKNOWN";
  let invalid = false;
  let frozen = null;
  let publication = null;
  let observing = false;
  const records = [];
  const protect = (fn) => {
    if (!enabled || frozen) return;
    if (observing) { invalid = true; return; }
    observing = true;
    try { fn(); } catch { invalid = true; } finally { observing = false; }
  };
  const offsetNow = () => {
    const raw = clock();
    if (!Number.isFinite(raw) || origin === null) throw new Error("invalid clock");
    return raw - origin;
  };
  const append = (operation, kind, offsetMs) => {
    if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs < last || records.length >= MAX_ROWS) {
      invalid = true;
      return;
    }
    last = offsetMs;
    records.push(Object.freeze({ operation, kind, offsetMs }));
  };
  const noteFailure = (operation, value) => {
    if (firstErrorPresent) return;
    if (terminal || active !== operation || !OPERATIONS.includes(operation)) { invalid = true; return; }
    // Presence is independent of truthiness; no thrown-object properties are read.
    firstErrorPresent = true;
    firstFailedOperation = operation;
    firstErrorKind = value === null ? "null" : typeof value;
    append(operation, "error", offsetNow());
  };
  const api = {
    start(startedAt) {
      protect(() => {
        if (origin !== null || !Number.isFinite(startedAt) || startedAt < 0) { invalid = true; return; }
        origin = startedAt;
        append("total", "start", 0);
      });
    },
    enter(operation) {
      protect(() => {
        if (terminal || active !== null || operation !== OPERATIONS[index] || firstErrorPresent) { invalid = true; return; }
        active = operation;
        append(operation, "enter", offsetNow());
      });
    },
    returned(operation) {
      protect(() => {
        if (terminal || active !== operation || firstErrorPresent) { invalid = true; return; }
        append(operation, "return", offsetNow());
        active = null;
        index += 1;
      });
    },
    failed(operation, value) {
      protect(() => noteFailure(operation, value));
    },
    finish(fixtureLoadMs) {
      protect(() => {
        if (terminal || active !== null || index !== OPERATIONS.length || firstErrorPresent) { invalid = true; return; }
        terminal = true;
        status = "returned";
        // Reuse the original measured boundary; do not take a new total clock read.
        append("total", "return", fixtureLoadMs);
      });
    },
    rejected(value) {
      protect(() => {
        if (terminal) return;
        if (active !== null && !firstErrorPresent) noteFailure(active, value);
        if (!firstErrorPresent) { invalid = true; return; }
        terminal = true;
        status = "rejected";
        append("total", "error", offsetNow());
      });
    },
    freeze() {
      if (!frozen) {
        if (!terminal) invalid = true;
        frozen = Object.freeze({
          version: 1, targetCommit: TARGET_COMMIT, donorSha256: DONOR_SHA256,
          clockDomain: "host-node-performance", maxRows: MAX_ROWS,
          records: Object.freeze(records.map((row) => Object.freeze({ ...row }))),
          terminal, status, firstFailedOperation, firstErrorPresent, firstErrorKind,
          observerInvalid: invalid || !enabled,
        });
      }
      return frozen;
    },
    publish(path, { serialize = JSON.stringify, write = writeFileSync } = {}) {
      if (publication) return publication;
      // Freeze before any serializer or filesystem call can run or re-enter.
      const snapshot = api.freeze();
      const fail = (reason) => {
        invalid = true;
        publication = Object.freeze({ published: false, observerInvalid: true, reason });
        return publication;
      };
      // Claim this attempt before callbacks. Re-entry cannot create a second file.
      publication = Object.freeze({ published: false, observerInvalid: true, reason: "publication-in-progress" });
      try {
        if (!enabled || !snapshot.terminal) return fail("missing-terminal");
        const filename = path instanceof URL ? fileURLToPath(path) : path;
        if (typeof filename !== "string" || !isAbsolute(filename) || basename(filename) !== LEDGER_BASENAME) return fail("invalid-path");
        const serialized = serialize(snapshot);
        if (typeof serialized !== "string") return fail("invalid-serialization");
        const data = `${serialized}\n`;
        if (Buffer.byteLength(data, "utf8") > MAX_BYTES) return fail("byte-cap");
        // A serializer may not substitute a different payload or fabricate valid facts.
        if (JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(snapshot)) return fail("invalid-serialization");
        write(filename, data, { flag: "wx", mode: 0o600 });
        publication = Object.freeze({ published: true, observerInvalid: snapshot.observerInvalid, reason: snapshot.observerInvalid ? "invalid-observations" : null });
        return publication;
      } catch { return fail("publication-failed"); }
    },
  };
  return Object.freeze(api);
}
