"""Observe native WebKit children of the original hosted M47 receipt command."""

from collections import deque
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import time

SCHEMA = "coursecraft-zk256-webkit-native-observer-v1"
OUTPUT = Path("artifacts/zk682/failure-diagnostics/m47-native-process.json")
RECEIPT = OUTPUT.with_name("browser-supported.json")
PROC = Path("/proc")
CGROUP = Path("/sys/fs/cgroup")
MAX_SECONDS = 600
MAX_SAMPLES = 601
MAX_IDENTITIES = 64
MAX_PROC_ENTRIES = 4096
MAX_JOURNAL_BYTES = 64 * 1024
MAX_JOURNAL_ROWS = 64
MAX_OUTPUT_BYTES = 256 * 1024
EXECUTABLE_ROLES = {
    "MiniBrowser": "MiniBrowser",
    "WebKitWebProcess": "WebKitWebProcess",
    "WebKitNetworkProcess": "WebKitNetworkProcess",
    "WebKitGPUProcess": "WebKitGPUProcess",
    "WPEWebProcess": "WebKitWebProcess",
    "WPENetworkProcess": "WebKitNetworkProcess",
    "WPEGPUProcess": "WebKitGPUProcess",
}
KERNEL_FILTER = r"Killed process |segfault at |trap "


class ObservationLimit(Exception):
    pass


def small_bytes(path, limit=4096):
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ObservationLimit("input-bytes")
    return data


@dataclass(frozen=True)
class ProcStat:
    parent: int
    start: int
    rss_pages: int


def parse_stat(data):
    # The comm field can contain spaces and parentheses. Kernel fields follow its final ')'.
    _, close, tail = data.rpartition(b") ")
    values = tail.split()
    if not close or len(values) < 22:
        raise ValueError("invalid proc stat")
    return ProcStat(int(values[1]), int(values[19]), max(0, int(values[21])))


def read_proc(pid):
    return parse_stat(small_bytes(PROC / str(pid) / "stat"))


def boottime_us():
    return time.clock_gettime_ns(time.CLOCK_BOOTTIME) // 1000


def descendants(pid, identity):
    by_parent = {}
    root_found = False
    with os.scandir(PROC) as entries:
        for index, entry in enumerate(entries):
            if index >= MAX_PROC_ENTRIES:
                raise ObservationLimit("proc-inventory")
            if not entry.name.isdecimal():
                continue
            current = int(entry.name)
            try:
                stat = read_proc(current)
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
            if current == pid:
                root_found = stat.start == identity
            by_parent.setdefault(stat.parent, []).append((current, stat))
    if not root_found:
        return []
    pending = [(pid, identity)]
    seen = {pid}
    result = []
    while pending:
        parent, start = pending.pop()
        for child, stat in by_parent.get(parent, ()):
            if child in seen or stat.start < start:
                continue
            seen.add(child)
            result.append((child, stat))
            pending.append((child, stat.start))
    return result


def executable_role(pid, webkit_root):
    target = Path(os.readlink(PROC / str(pid) / "exe"))
    if target.is_relative_to(webkit_root):
        return EXECUTABLE_ROLES.get(target.name)
    return None


def confirm_ancestry(child, snapshot, browser_pids, command_pid, command_start):
    current = child
    subject = None
    saw_browser = False
    for _ in snapshot:
        expected = snapshot.get(current)
        if expected is None:
            return None
        actual = read_proc(current)
        if (actual.start, actual.parent) != (expected.start, expected.parent):
            return None
        if current == child:
            subject = actual
        saw_browser = saw_browser or current in browser_pids
        if current == command_pid:
            return subject if saw_browser and actual.start == command_start else None
        current = actual.parent
    return None


def cgroup_scope(pid):
    entries = small_bytes(PROC / str(pid) / "cgroup").decode().splitlines()
    line = next((line for line in entries if line.startswith("0::/")), None)
    if line is None:
        raise ValueError("no unified cgroup")
    path = (CGROUP / line[4:]).resolve(strict=True)
    if not path.is_relative_to(CGROUP):
        raise ValueError("invalid cgroup path")
    return path


def read_cgroup(path):
    stat = path.stat()
    scope_id = hashlib.sha256(f"{path}:{stat.st_dev}:{stat.st_ino}".encode()).hexdigest()
    scope = "local"
    try:
        counters = small_bytes(path / "memory.events.local")
    except FileNotFoundError:
        scope = "hierarchical"
        counters = small_bytes(path / "memory.events")
    decoded = dict(line.split() for line in counters.decode().splitlines())
    limit = small_bytes(path / "memory.max").strip()
    return {
        "status": "observed", "scopeId": scope_id, "scope": scope,
        "events": {name: int(decoded[name]) for name in ("high", "max", "oom", "oom_kill", "oom_group_kill") if name in decoded},
        "currentBytes": int(small_bytes(path / "memory.current")),
        "maxBytes": "unlimited" if limit == b"max" else int(limit),
    }


def cgroup_snapshot(path):
    if path is None:
        return {"status": "unmapped"}
    try:
        return read_cgroup(path)
    except (OSError, ValueError, ObservationLimit):
        return {"status": "unavailable"}


class Observer:
    def __init__(self, webkit_root):
        self.webkit_root = webkit_root
        self.records = {}
        self.recent = deque(maxlen=64)
        self.samples = 0
        self.partial_reason = None
        self.command_pid = None
        self.command_start_ticks = None
        self.command_scope = None
        self.command_baseline = {"status": "unmapped"}
        self.content_scope = None
        self.content_baseline = {"status": "unmapped"}
        self.content_scope_status = "unmapped"

    def begin(self, pid):
        stat = read_proc(pid)
        self.command_start_ticks = stat.start
        try:
            self.command_scope = cgroup_scope(pid)
        except (OSError, ValueError, ObservationLimit):
            pass
        self.command_baseline = cgroup_snapshot(self.command_scope)
        return stat.start

    def see(self, pid, stat, role, confirmed_before_us, seen_after_us):
        key = (pid, stat.start)
        if key not in self.records:
            if len(self.records) >= MAX_IDENTITIES:
                raise ObservationLimit("process-identities")
            self.records[key] = {
                "pid": pid, "parentPid": stat.parent, "startTicks": stat.start, "role": role,
                "firstSeenUs": seen_after_us, "lastSeenUs": seen_after_us,
                "lastConfirmedUs": confirmed_before_us, "firstAbsentUs": None, "peakSampledRssBytes": 0,
            }
        row = self.records[key]
        if row["firstAbsentUs"] is not None or row["role"] != role:
            raise ObservationLimit("process-identity-discontinuity")
        rss = stat.rss_pages * os.sysconf("SC_PAGE_SIZE")
        row["lastSeenUs"] = seen_after_us
        row["lastConfirmedUs"] = confirmed_before_us
        row["peakSampledRssBytes"] = max(rss, row["peakSampledRssBytes"])
        return rss

    def refresh_absence(self):
        for (pid, start), row in self.records.items():
            if row["firstAbsentUs"] is not None:
                continue
            before = boottime_us()
            try:
                absent = read_proc(pid).start != start
            except (FileNotFoundError, ProcessLookupError):
                absent = True
            except PermissionError:
                continue
            if absent:
                row["firstAbsentUs"] = boottime_us()
            else:
                # The same birth can be confirmed by stat even after the executable is gone.
                row["lastConfirmedUs"] = before

    def sample(self, pid, start, at_us):
        if self.samples >= MAX_SAMPLES:
            raise ObservationLimit("sample-count")
        self.samples += 1
        owned = descendants(pid, start)
        if not owned:
            self.refresh_absence()
            self.recent.append({"atUs": at_us, "processRss": []})
            return
        snapshot = dict(owned)
        try:
            snapshot[pid] = read_proc(pid)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            return
        # Role is asserted only on the executable under the pinned WebKit installation.
        # Check every link's actual birth and PPID after reading executable metadata.
        identified = {}
        for child, _ in owned:
            try:
                role = executable_role(child, self.webkit_root)
                if role is not None:
                    identified[child] = role
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
        browser_pids = {child for child, role in identified.items() if role == "MiniBrowser"}
        sampled = []
        for child, role in identified.items():
            before = boottime_us()
            try:
                stat = confirm_ancestry(child, snapshot, browser_pids, pid, start)
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
            if stat is None:
                continue
            rss = self.see(child, stat, role, before, boottime_us())
            sampled.append([child, stat.start, rss])
            if role == "WebKitWebProcess":
                self.observe_content_scope(child)
        self.refresh_absence()
        self.recent.append({"atUs": at_us, "processRss": sampled})

    def observe_content_scope(self, pid):
        try:
            path = cgroup_scope(pid)
        except (OSError, ValueError, ObservationLimit):
            return
        if self.content_scope_status == "unmapped":
            self.content_scope = path
            self.content_baseline = cgroup_snapshot(path)
            self.content_scope_status = "mapped"
        elif path != self.content_scope:
            self.content_scope_status = "mixed-or-migrated"

    def scopes(self):
        return {
            "command": {"baseline": self.command_baseline, "end": cgroup_snapshot(self.command_scope)},
            "webContent": {"status": self.content_scope_status, "baseline": self.content_baseline,
                           "end": cgroup_snapshot(self.content_scope)},
        }


def journal_window(begin, end):
    command = [
        "journalctl", "--dmesg", "--boot=0", f"--since=@{begin:.6f}", f"--until=@{end:.6f}",
        f"--grep={KERNEL_FILTER}", "--lines=65", "--no-pager", "--output=json",
        "--output-fields=MESSAGE,_TRANSPORT,SYSLOG_FACILITY,_SOURCE_BOOTTIME_TIMESTAMP",
    ]
    deadline = time.monotonic() + 5
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as child:
        raw = bytearray()
        try:
            while select.select([child.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                block = os.read(child.stdout.fileno(), min(4096, MAX_JOURNAL_BYTES + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
                if len(raw) > MAX_JOURNAL_BYTES or time.monotonic() >= deadline:
                    raise ObservationLimit("journal-limit")
            else:
                raise ObservationLimit("journal-time")
            code = child.wait(timeout=max(0, deadline - time.monotonic()))
        except (ObservationLimit, subprocess.TimeoutExpired):
            child.kill()
            return "partial-limit", []
    return decode_journal(code, raw)


def decode_journal(code, raw):
    if len(raw) > MAX_JOURNAL_BYTES:
        return "partial-limit", []
    if b"permission" in raw.lower() or b"access denied" in raw.lower():
        return "unavailable-permission", []
    if code != 0:
        return "unavailable", []
    if not raw:
        return "empty-or-unavailable", []
    try:
        rows = [json.loads(line) for line in raw.splitlines()]
    except ValueError:
        return "unavailable-format", []
    if len(rows) > MAX_JOURNAL_ROWS:
        return "partial-limit", []
    return "observed", rows


def kernel_event(row, boot):
    if not isinstance(row, dict) or not isinstance(row.get("_BOOT_ID"), str):
        return None
    if row["_BOOT_ID"].replace("-", "") != boot:
        return None
    if row.get("_TRANSPORT") != "kernel" or row.get("SYSLOG_FACILITY") != "0":
        return None
    message = row.get("MESSAGE")
    # Journal receipt time is not the timestamp of the native event.
    stamp = row.get("_SOURCE_BOOTTIME_TIMESTAMP")
    if not isinstance(message, str) or not isinstance(stamp, str) or not re.fullmatch(r"[0-9]{1,18}", stamp):
        return None
    victim = re.search(r"(?:^|\s)(?:Memory cgroup out of memory: |Out of memory: )Killed process ([0-9]{1,10}) \(", message)
    fault = re.search(r"(?:^|\s)[A-Za-z0-9_.-]{1,32}\[([0-9]{1,10})\](?:: segfault at | trap )", message)
    match = victim or fault
    if match is None:
        return None
    kind = "oom-victim" if victim else "native-fault"
    return {"kind": kind, "pid": int(match.group(1)), "atUs": int(stamp)}


def correlate(journal_status, rows, records, boot, begin_us, end_us, partial):
    found = []
    if journal_status == "observed" and not partial:
        for row in rows:
            event = kernel_event(row, boot)
            if event is None or not begin_us <= event["atUs"] <= end_us:
                continue
            current = [record for record in records if record["role"] == "WebKitWebProcess"
                       and record["firstSeenUs"] < event["atUs"] < record["lastConfirmedUs"]]
            if len(current) != 1 or current[0]["pid"] != event["pid"]:
                continue
            found.append({**event, "startTicks": current[0]["startTicks"]})
    verdict = "OWNED_NATIVE_EVENT" if found else "UNKNOWN"
    return {"status": verdict, "ownedProcessEvents": found}


def summarize_journal(rows, records, boot, begin_us, end_us, qualified):
    known_pids = {record["pid"] for record in records}
    qualified_keys = {(event["kind"], event["pid"], event["atUs"]) for event in qualified}
    rejected = len(rows)
    candidates = []
    for row in rows[:MAX_JOURNAL_ROWS]:
        event = kernel_event(row, boot)
        if event is None or not begin_us <= event["atUs"] <= end_us:
            continue
        if (event["kind"], event["pid"], event["atUs"]) in qualified_keys:
            rejected -= 1
        elif event["pid"] in known_pids:
            candidates.append({**event, "status": "UNQUALIFIED", "reason": "no-proved-owned-lifetime"})
    return {"queriedRows": len(rows), "rejectedRows": rejected, "unqualifiedPidCandidates": candidates}


def embedded_receipt(path, commit):
    try:
        raw = json.loads(small_bytes(path, 16 * 1024))
        code = raw["exitCode"]
        if (raw["schemaVersion"], raw["kind"], raw["receiptId"], raw["candidateCommit"]) != (1, "command-receipt", "browser-supported", commit):
            return {"status": "unqualified"}
        if type(code) is not int or code < 0 or raw["passed"] is not (code == 0):
            return {"status": "unqualified"}
        return {"status": "observed", "exitCode": code, "passed": raw["passed"]}
    except (OSError, ValueError, KeyError, TypeError, ObservationLimit):
        return {"status": "unavailable"}


def run_child(argv, observer):
    with subprocess.Popen(argv) as child:
        observer.command_pid = child.pid
        started = time.monotonic()
        try:
            identity = observer.begin(child.pid)
            while child.poll() is None:
                now = time.monotonic()
                if now - started >= MAX_SECONDS:
                    raise ObservationLimit("sample-window")
                observer.sample(child.pid, identity, boottime_us())
                try:
                    child.wait(timeout=max(0, now + 1 - time.monotonic()))
                except subprocess.TimeoutExpired:
                    continue
        except (OSError, ValueError, ObservationLimit) as error:
            observer.partial_reason = str(error) if isinstance(error, ObservationLimit) else type(error).__name__
        code = child.wait()
    try:
        observer.refresh_absence()
    except (OSError, ValueError, ObservationLimit) as error:
        observer.partial_reason = observer.partial_reason or type(error).__name__
    return code


def propagate(code):
    if code < 0:
        signum = -code
        if signum not in (signal.SIGKILL, signal.SIGSTOP):
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
        return 128 + signum
    return code


def expected_command(commit):
    return [
        "env", "-u", "GITHUB_SHA", "node", "scripts/zk682-run-command-receipt.mjs",
        "--id", "browser-supported", "--output", str(RECEIPT), "--candidate", commit,
        "--", "npm", "run", "test:release:browsers", "--", "e2e/m47-certification.e2e.ts",
        "--grep-invert", "ZK-813", "--project=webkit-safari-proxy", "--workers=1", "--retries=0",
        "--reporter=list,json",
    ]


def main(args):
    commit = os.environ.get("ZK682_EXPECTED_COMMIT", "")
    run = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if (sys.platform != "linux" or not re.fullmatch(r"[0-9a-f]{40}", commit)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", run)
            or not re.fullmatch(r"[1-9][0-9]{0,5}", attempt)
            or args != ["--", *expected_command(commit)]):
        print("M47 native observer: original hosted command identity required", file=sys.stderr)
        return 2
    observer = Observer(Path.home() / ".cache/ms-playwright/webkit-2311")
    start_wall = time.time()
    begin_us = boottime_us()
    try:
        boot = small_bytes(PROC / "sys/kernel/random/boot_id").decode().strip().replace("-", "")
        if not re.fullmatch(r"[0-9a-f]{32}", boot):
            boot = None
    except (OSError, ValueError, ObservationLimit):
        boot = None
    try:
        code = run_child(args[1:], observer)
    except OSError as error:
        observer.partial_reason = "child-launch"
        code = 127 if isinstance(error, FileNotFoundError) else 126
    end_us = boottime_us()
    end_wall = time.time()
    try:
        journal_status, rows = journal_window(start_wall, end_wall) if boot else ("unmapped-boot", [])
    except (OSError, ValueError):
        journal_status, rows = "unavailable", []
    records = list(observer.records.values())
    receipt = {
        "schema": SCHEMA, "candidateCommit": commit, "runId": run, "runAttempt": attempt,
        "child": {"pid": observer.command_pid, "startTicks": observer.command_start_ticks,
                  "exitCode": code if code >= 0 else None, "signal": -code if code < 0 else None},
        "originalCommandReceipt": embedded_receipt(RECEIPT, commit),
    }
    native = correlate(journal_status, rows, records, boot, begin_us, end_us, observer.partial_reason)
    output = {
        **receipt, "bootId": boot, "processClock": "CLOCK_BOOTTIME", "intervalUs": [begin_us, end_us],
        "intervalRealtimeUs": [int(start_wall * 1_000_000), int(end_wall * 1_000_000)], "samples": observer.samples,
        "partialReason": observer.partial_reason, "processes": records, "recentSamples": list(observer.recent),
        "cgroups": observer.scopes(), "journalStatus": journal_status,
        "nativeEvidence": native,
        "journalEvidence": summarize_journal(rows, records, boot, begin_us, end_us, native["ownedProcessEvents"]),
    }
    try:
        payload = json.dumps(output, separators=(",", ":")) + "\n"
        if len(payload.encode()) > MAX_OUTPUT_BYTES:
            payload = json.dumps({
                **receipt, "partialReason": "output-cap",
                "nativeEvidence": {"status": "UNKNOWN", "ownedProcessEvents": []},
                "journalStatus": journal_status,
                "journalEvidence": summarize_journal(rows, records, boot, begin_us, end_us, []),
            }) + "\n"
        with OUTPUT.open("x") as stream:
            stream.write(payload)
    except OSError:
        print("M47 native observer: diagnostic output unavailable", file=sys.stderr)
    return propagate(code)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
