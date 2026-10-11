// STATIC SOURCE2/3. No execution/admission is implied by this file.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';

export const CAPTURE = Object.freeze({ bytes: 134217728, decodedUtf16Bytes: 134217728,
  deadlineMs: 120000, summaryBytes: 32768, blockChars: 16384, eintrRetries: 256 });
export const CANDIDATE = 'b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025';
export const PUBLICATION_AMENDMENT_SHA256 = '46b63243a78085ead78720766f1c5031ba0b75acb8bec82865f73d17916544f9';
export function firstCause() {
  return { present: false, value: undefined, record(value) {
    if (!this.present) { this.present = true; this.value = value; }
  } };
}
function causeDescription(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', text: value.slice(0, 512) };
  if (typeof value === 'number' || typeof value === 'boolean') return { type: typeof value, value: String(value) };
  if (typeof value === 'object') {
    try {
      const code = Object.getOwnPropertyDescriptor(value, 'code')?.value;
      if (typeof code === 'string') return { type: 'object', code: code.slice(0, 160) };
    } catch {}
  }
  return { type: typeof value }; // Never call an arbitrary thrown value's getter/toString.
}
function fault(code) { const error = new Error(code); error.code = code; return error; }
function retry(op, io, maximum = CAPTURE.eintrRetries) {
  let interruptions = 0;
  for (;;) {
    try { return op(); } catch (error) {
      if (error?.code !== 'EINTR' || ++interruptions > maximum) throw error;
      io?.onEintr?.();
    }
  }
}
export function writeAllSync(io, fd, buffer, check = () => {}) {
  let offset = 0;
  while (offset < buffer.length) {
    const wrote = retry(() => { check(); return io.writeSync(fd, buffer, offset, buffer.length - offset, null); }, io);
    if (!Number.isSafeInteger(wrote) || wrote <= 0 || wrote > buffer.length - offset) throw fault('SHORT_WRITE_INVALID');
    offset += wrote;
  }
}
function sameInode(a, b) { return a.dev === b.dev && a.ino === b.ino && a.isFile() && b.isFile(); }
function openNew(io, path) { return io.openSync(path, 'wx', 0o600); }
function hashFd(io, fd, bytes, deadlineCheck) {
  const block = Buffer.alloc(65536); const hash = createHash('sha256'); let position = 0;
  while (position < bytes) {
    deadlineCheck();
    const got = retry(() => { deadlineCheck(); return io.readSync(fd, block, 0, Math.min(block.length, bytes - position), position); }, io);
    if (!Number.isSafeInteger(got) || got <= 0) throw fault('INDEPENDENT_HASH_TRUNCATED');
    hash.update(block.subarray(0, got)); position += got;
  }
  if (retry(() => io.readSync(fd, block, 0, 1, bytes), io) !== 0) throw fault('INDEPENDENT_HASH_EXTRA_BYTES');
  return hash.digest('hex');
}
function syncDirectory(io, directory) {
  const fd = io.openSync(directory, 'r');
  const failure = firstCause();
  try { retry(() => io.fsyncSync(fd), io); } catch (error) { failure.record(error); }
  finally { try { io.closeSync(fd); } catch (error) { failure.record(error); } }
  if (failure.present) throw failure.value;
}
export function durableStatus(io, path, status, owned) {
  const data = Buffer.from(JSON.stringify(status) + '\n', 'utf8');
  if (data.length > CAPTURE.summaryBytes) throw fault('STATUS_CAP');
  if (owned && !sameInode(owned, io.lstatSync(path))) throw fault('STATUS_REWRITE_PATH_IDENTITY');
  const fd = owned ? io.openSync(path, 'r+') : openNew(io, path);
  let closeAttempted = false; const failure = firstCause(); let completedIdentity;
  try {
    const opened = io.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) throw fault('STATUS_INODE');
    if (owned && (!sameInode(owned, opened) || !sameInode(opened, io.lstatSync(path)))) throw fault('STATUS_REWRITE_FD_IDENTITY');
    writeAllSync(io, fd, data);
    if (owned) retry(() => io.ftruncateSync(fd, data.length), io); // Only this proven owned status inode.
    retry(() => io.fsyncSync(fd), io);
    const after = io.fstatSync(fd); const named = io.lstatSync(path);
    if (!sameInode(opened, after) || !sameInode(after, named) || after.size !== data.length) throw fault('STATUS_IDENTITY');
    completedIdentity = after;
    closeAttempted = true; io.closeSync(fd); syncDirectory(io, dirname(path));
  } catch (error) { failure.record(error); }
  finally { if (!closeAttempted) { try { io.closeSync(fd); } catch (error) { failure.record(error); } } }
  if (failure.present) throw failure.value;
  return completedIdentity;
}

function parentIdentity(io, part, final, expectedParent) {
  const directory = dirname(part);
  if (dirname(final) !== directory || io.realpathSync(directory) !== directory) throw fault('PARENT_ALIAS_OR_NOT_SAME_PARENT');
  const stat = io.lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw fault('PARENT_NOT_PRIVATE_OWNED_DIRECTORY');
  if (expectedParent && (stat.dev !== expectedParent.dev || stat.ino !== expectedParent.ino)) throw fault('PARENT_IDENTITY_CHANGED');
  return { dev: stat.dev, ino: stat.ino };
}
// Registered hard-link/unlink amendment. This is NOT rename(2). The exact
// amendment is bound above; ROOT still owns all runtime/lease admission.
export function publishNoReplaceLink(io, part, final, fd, expected, bytes, expectedHash, deadlineCheck = () => {}, expectedParent) {
  const parent = parentIdentity(io, part, final, expectedParent);
  const opened = io.fstatSync(fd); const named = io.lstatSync(part);
  if (!sameInode(expected, opened) || !sameInode(opened, named) || opened.size !== bytes || opened.nlink !== 1) throw fault('PART_IDENTITY');
  retry(() => io.fsyncSync(fd), io);
  io.linkSync(part, final); // EEXIST refuses, including foreign file/symlink.
  const linked = io.lstatSync(final); const partLinked = io.lstatSync(part);
  if (!sameInode(opened, linked) || !sameInode(opened, partLinked) || linked.nlink !== 2 || linked.size !== bytes) throw fault('FINAL_LINK_IDENTITY');
  if (hashFd(io, fd, bytes, deadlineCheck) !== expectedHash) throw fault('LINKED_HASH_MISMATCH');
  parentIdentity(io, part, final, parent);
  syncDirectory(io, dirname(final));
  const beforeUnlink = io.lstatSync(part);
  if (!sameInode(expected, beforeUnlink) || beforeUnlink.nlink !== 2 || beforeUnlink.size !== bytes) throw fault('OWNED_PART_BEFORE_UNLINK');
  io.unlinkSync(part);
  const finalStat = io.lstatSync(final); const finalFd = io.fstatSync(fd);
  if (!sameInode(expected, finalStat) || !sameInode(finalStat, finalFd) || finalStat.nlink !== 1 || finalStat.size !== bytes) throw fault('FINAL_SINGLE_LINK_IDENTITY');
  syncDirectory(io, dirname(final));
  parentIdentity(io, part, final, parent);
  if (hashFd(io, fd, bytes, deadlineCheck) !== expectedHash) throw fault('FINAL_HASH_MISMATCH');
  return { dev: String(finalStat.dev), ino: String(finalStat.ino), bytes: finalStat.size, nlink: finalStat.nlink,
    sha256: expectedHash, parentDev: String(parent.dev), parentIno: String(parent.ino) };
}

export function createChunkSink({ io, fd, cap = CAPTURE.bytes, decodedCap = CAPTURE.decodedUtf16Bytes,
  failure, deadlineCheck = () => {}, hash = createHash('sha256') }) {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > CAPTURE.bytes || !Number.isSafeInteger(decodedCap) || decodedCap < 1 || decodedCap > CAPTURE.decodedUtf16Bytes) throw fault('SINK_CAP_CONFIGURATION');
  const state = { bytes: 0, decodedUtf16Bytes: 0, chunks: 0, carry: '', writes: 0, stopped: false };
  function encoded(text) {
    deadlineCheck();
    // Count before allocating the bounded encoded block or attempting any write.
    const charge = Buffer.byteLength(text, 'utf8');
    if (state.bytes + charge > cap) throw fault('SNAPSHOT_BYTE_CAP');
    state.bytes += charge;
    const block = Buffer.from(text, 'utf8');
    writeAllSync(io, fd, block, deadlineCheck); hash.update(block); state.writes += 1;
  }
  function accept(payload) {
    if (state.stopped || failure.present) return;
    try {
      deadlineCheck();
      if (!payload || typeof payload.chunk !== 'string') throw fault('CHUNK_NOT_STRING');
      const text = payload.chunk;
      const decodedCharge = text.length * 2;
      if (!Number.isSafeInteger(decodedCharge) || state.decodedUtf16Bytes + decodedCharge > decodedCap) throw fault('DECODED_UTF16_CAP');
      state.decodedUtf16Bytes += decodedCharge;
      if (state.chunks === Number.MAX_SAFE_INTEGER) throw fault('CHUNK_COUNTER_CAP');
      state.chunks += 1;
      let start = 0;
      if (state.carry) {
        if (!text.length) return;
        const first = text.charCodeAt(0);
        if (first >= 0xdc00 && first <= 0xdfff) { encoded(state.carry + text[0]); start = 1; }
        else encoded(state.carry); // Same replacement semantics as whole-string UTF8.
        state.carry = '';
      }
      while (start < text.length) {
        let end = Math.min(text.length, start + CAPTURE.blockChars);
        const last = text.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
          if (end === text.length) { state.carry = text[end - 1]; end -= 1; }
          else end -= 1;
        }
        if (end > start) encoded(text.slice(start, end));
        start = end;
        if (state.carry) break;
      }
    } catch (error) { failure.record(error); state.stopped = true; }
  }
  function finish() {
    if (failure.present) throw failure.value;
    deadlineCheck();
    if (state.carry) { encoded(state.carry); state.carry = ''; }
    if (!state.chunks || !state.bytes) throw fault('ABSENT_CHUNKS');
    state.stopped = true;
    return hash.digest('hex');
  }
  return { state, accept, finish, stop() { state.stopped = true; state.carry = ''; } };
}

export async function captureSaveFinalOwnerGraph(cdp, options, dependencies = {}) {
  const io = dependencies.io ?? fs;
  const now = dependencies.now ?? (() => performance.now());
  const schedule = dependencies.setTimeout ?? setTimeout;
  const cancel = dependencies.clearTimeout ?? clearTimeout;
  const admission = dependencies.admission ?? process.env.ZK1262_OWNER_CAPTURE_ADMISSION;
  const publicationReceipt = dependencies.publicationReceipt ?? process.env.ZK1262_OWNER_LINK_PUBLICATION_RECEIPT_SHA256;
  if (admission !== 'ROOT_REGISTERED_ONCE_B7_SOURCE1' || publicationReceipt !== PUBLICATION_AMENDMENT_SHA256) throw fault('RUNTIME_NOT_ADMITTED_OR_PUBLICATION_AMENDMENT_UNBOUND');
  if (options.candidateCommit !== CANDIDATE || options.sampleCount !== 13) throw fault('CANDIDATE_OR_FINAL_SAVE_BOUNDARY');
  if (!Array.isArray(options.saveReportErrors) || options.saveReportErrors.length > 32 || options.saveReportErrors.some(x => typeof x !== 'string' || x.length > 512)) throw fault('SAVE_ERROR_METADATA_CAP');
  const directory = resolve(options.outputDirectory);
  const part = resolve(directory, 'save-final-owner.heapsnapshot.part');
  const final = resolve(directory, 'save-final-owner.heapsnapshot');
  const statusPath = resolve(directory, 'save-final-owner.preclose.json');
  const parent = parentIdentity(io, part, final);
  for (const path of [part, final, statusPath]) {
    try { io.lstatSync(path); throw fault('OUTPUT_ALREADY_EXISTS'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const failure = firstCause(); const cleanup = [];
  const started = now(); let fd; let identity; let sink; let timer;
  let commandSettled = false; let commandResolved = false; let listenersAttempted = false;
  let independentHash = null; let streamedHash = null; let publication = null; let fsynced = false;
  const status = { schema: 1, candidateCommit: CANDIDATE, noncanonical: true,
    snapshotPerturbsLaterStages: true, canonicalCredit: false, graphAccepted: false,
    publicationMethod: 'registered-exclusive-hardlink-unlink', publicationAmendmentSHA256: publicationReceipt,
    originalSaveErrors: options.saveReportErrors.slice(), sampleCount: 13,
    nativeAbort: 'UNKNOWN', nativeBackpressure: 'UNKNOWN', transportBufferBound: 'UNKNOWN',
    deadlineMs: CAPTURE.deadlineMs, durablePreclose: false, helperOwnsDetachOrClose: false,
    downstream: 'NOT_COMPLETED_AT_HELPER_BOUNDARY' };
  let rejectFailure;
  const refused = new Promise((_, reject) => { rejectFailure = reject; });
  function deadlineCheck() { if (now() - started >= CAPTURE.deadlineMs) throw fault('SNAPSHOT_DEADLINE'); }
  function completionAdmission() {
    const elapsed = now() - started; const late = elapsed >= CAPTURE.deadlineMs;
    if (late) failure.record(fault('SNAPSHOT_DEADLINE'));
    return { elapsed, late };
  }
  const chunkListener = payload => {
    sink.accept(payload);
    if (failure.present) rejectFailure(failure.value);
  };
  const closeListener = () => { failure.record(fault('SESSION_CLOSED')); sink.stop(); rejectFailure(failure.value); };
  try {
    fd = io.openSync(part, 'wx+', 0o600); identity = io.fstatSync(fd);
    if (!identity.isFile() || identity.nlink !== 1) throw fault('PART_NOT_FRESH_REGULAR');
    sink = createChunkSink({ io, fd, failure, deadlineCheck });
    listenersAttempted = true;
    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunkListener);
    cdp.on('close', closeListener);
    timer = schedule(() => {
      failure.record(fault('SNAPSHOT_DEADLINE')); sink.stop(); rejectFailure(failure.value);
    }, CAPTURE.deadlineMs);
    // Exact installed public signature; omitted protocol options and one send.
    const command = Promise.resolve().then(() => {
      deadlineCheck(); if (failure.present) throw failure.value;
      return cdp.send('HeapProfiler.takeHeapSnapshot');
    })
      .then(value => { commandSettled = true; commandResolved = true; return value; },
        error => { commandSettled = true; failure.record(error); throw failure.value; });
    // Attach rejection consumption even if the deadline wins. No cancellation claim.
    command.catch(() => {});
    await Promise.race([command, refused]);
    deadlineCheck();
    if (failure.present) throw failure.value;
    // Public methods are source-bound; serializer/transport completion is not
    // inferred from response alone. Absent/truncated/late bytes stay unaccepted
    // until the independently admitted strict parser.
    streamedHash = sink.finish();
    retry(() => io.fsyncSync(fd), io); fsynced = true;
    independentHash = hashFd(io, fd, sink.state.bytes, deadlineCheck);
    if (streamedHash !== independentHash) throw fault('SNAPSHOT_HASH_MISMATCH');
    deadlineCheck();
    publication = publishNoReplaceLink(io, part, final, fd, identity, sink.state.bytes, independentHash, deadlineCheck, parent);
    deadlineCheck(); // Includes the final EOF read and synchronous publication tail.
  } catch (error) { failure.record(error); }
  finally {
    if (timer !== undefined) { try { cancel(timer); } catch (error) { cleanup.push(causeDescription(error)); failure.record(error); } }
    if (sink) sink.stop();
    // Exact identities are attempted independently, including partially installed listeners.
    if (listenersAttempted) for (const [event, listener] of [['HeapProfiler.addHeapSnapshotChunk', chunkListener], ['close', closeListener]]) {
      try { cdp.off(event, listener); } catch (error) { cleanup.push(causeDescription(error)); failure.record(error); }
    }
    if (fd !== undefined) {
      try { io.closeSync(fd); } catch (error) { cleanup.push(causeDescription(error)); failure.record(error); }
    }
    const admission = completionAdmission(); // Required off/FD cleanup has completed.
    Object.assign(status, { elapsedMs: Math.ceil(admission.elapsed), completionAdmissionElapsedMs: admission.elapsed,
      observedDeadlineExceeded: admission.late, commandSettled, commandResolved,
      completeTransportFile: !!publication && !failure.present, fsynced, publication,
      bytesCharged: sink?.state.bytes ?? 0, decodedUtf16BytesCharged: sink?.state.decodedUtf16Bytes ?? 0,
      chunks: sink?.state.chunks ?? 0, writes: sink?.state.writes ?? 0,
      streamedSHA256: streamedHash, independentSHA256: independentHash,
      firstFailurePresent: failure.present, firstFailure: failure.present ? causeDescription(failure.value) : null,
      cleanupFailures: cleanup.slice(0, 8), durablePreclose: true,
      closureReceiptRequired: true, independentSchemaAdmissionRequired: true,
      downstream: publication && !failure.present ? 'MAY_CONTINUE_ORIGINAL_ORDER_SNAPSHOT_PERTURBED' : 'NOT_COMPLETED_AT_HELPER_BOUNDARY' });
    try {
      const statusIdentity = durableStatus(io, statusPath, status);
      const afterStatus = completionAdmission(); // Synchronous status I/O can finish late.
      if (afterStatus.late && !admission.late) {
        Object.assign(status, { elapsedMs: Math.ceil(afterStatus.elapsed), completionAdmissionElapsedMs: afterStatus.elapsed,
          observedDeadlineExceeded: true, completeTransportFile: false,
          firstFailurePresent: failure.present, firstFailure: causeDescription(failure.value),
          downstream: 'NOT_COMPLETED_AT_HELPER_BOUNDARY' });
        // Persist HOLD before rethrow/parent teardown; retain all snapshot evidence.
        durableStatus(io, statusPath, status, statusIdentity);
      }
    } catch (error) {
      failure.record(error); status.durablePreclose = false;
      status.completeTransportFile = false; status.downstream = 'NOT_COMPLETED_AT_HELPER_BOUNDARY';
    }
  }
  if (failure.present) throw failure.value; // Explicit flag preserves undefined/null/false.
  return status;
}
