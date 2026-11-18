import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name("zk682-m47-native-observer.py")
SPEC = importlib.util.spec_from_file_location("m47_native_observer", HELPER)
observer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = observer
SPEC.loader.exec_module(observer)

BOOT = "a" * 32
ROOT = Path("/browsers/webkit-2311")


def process(pid=123, start=100, first=10, last=30, absent=40):
    return {"pid": pid, "startTicks": start, "role": "WebKitWebProcess",
            "firstSeenUs": first, "lastSeenUs": last, "lastConfirmedUs": last, "firstAbsentUs": absent}


def event(pid=123, at=25, boot=BOOT, message=None):
    return {"_BOOT_ID": boot, "_TRANSPORT": "kernel", "SYSLOG_FACILITY": "0",
            "_SOURCE_BOOTTIME_TIMESTAMP": str(at), "__MONOTONIC_TIMESTAMP": str(at + 500),
            "MESSAGE": message or f"Out of memory: Killed process {pid} (WebKitWebProces)"}


class NativeObserverTest(unittest.TestCase):
    def test_proc_parser_uses_final_comm_delimiter_and_named_fields(self):
        fields = ["S", "86", *["0"] * 17, "415", "0", "100"]
        self.assertEqual(observer.parse_stat(("123 (process () name) " + " ".join(fields)).encode()),
                         observer.ProcStat(86, 415, 100))
        with self.assertRaises(ValueError):
            observer.parse_stat(b"123 (incomplete")

    def test_web_process_requires_verified_executable_under_owned_minibrowser(self):
        tracker = observer.Observer(ROOT)
        launcher = observer.ProcStat(1, 10, 7)
        owned_web = observer.ProcStat(2, 11, 8)
        orphan = observer.ProcStat(1, 12, 9)
        recycled = observer.ProcStat(2, 14, 10)
        snapshot = [(2, launcher), (3, owned_web), (4, orphan), (5, recycled)]
        reread = {1: observer.ProcStat(0, 1, 0), 2: launcher, 3: owned_web, 4: orphan, 5: observer.ProcStat(2, 18, 0)}
        roles = {2: "MiniBrowser", 3: "WebKitWebProcess", 4: "WebKitWebProcess", 5: "WebKitWebProcess"}
        with patch.object(observer, "descendants", return_value=snapshot), patch.object(observer, "read_proc", side_effect=reread.__getitem__), patch.object(observer, "executable_role", side_effect=lambda pid, root: roles[pid]), patch.object(observer, "cgroup_scope", side_effect=PermissionError), patch.object(observer, "boottime_us", return_value=100):
            tracker.sample(1, 1, 100)
        self.assertEqual(set(tracker.records), {(2, 10), (3, 11)})
        with patch.object(observer.os, "readlink", return_value="/foreign/WebKitWebProcess"):
            self.assertIsNone(observer.executable_role(99, ROOT))

    def test_reread_rejects_recycled_or_reparented_ancestor_with_same_web_process(self):
        snapshot = {
            1: observer.ProcStat(0, 1, 0), 2: observer.ProcStat(1, 10, 0),
            3: observer.ProcStat(2, 11, 0), 4: observer.ProcStat(3, 12, 10),
        }
        with patch.object(observer, "read_proc", side_effect=snapshot.__getitem__):
            self.assertEqual(observer.confirm_ancestry(4, snapshot, {2}, 1, 1), snapshot[4])
        for wrong in (observer.ProcStat(2, 99, 0), observer.ProcStat(9, 11, 0)):
            changed = {**snapshot, 3: wrong}
            with patch.object(observer, "read_proc", side_effect=changed.__getitem__):
                self.assertIsNone(observer.confirm_ancestry(4, snapshot, {2}, 1, 1))

    def test_real_proc_fixture_enrolls_wpe_children_and_maps_the_content_cgroup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            proc = root / "proc"
            webkit = root / ".cache/ms-playwright/webkit-2311"
            wpe = webkit / "minibrowser-wpe/bin"
            cgroup = root / "cgroup"
            scope = cgroup / "job.slice/content.scope"
            scope.mkdir(parents=True)
            (scope / "memory.events.local").write_text("oom 0\noom_kill 0\n")
            (scope / "memory.current").write_text("123456\n")
            (scope / "memory.max").write_text("max\n")
            children = [
                (1, 0, 1, None),
                (2, 1, 10, wpe / "MiniBrowser"),
                (3, 2, 11, wpe / "WPEWebProcess"),
                (4, 2, 12, wpe / "WPENetworkProcess"),
                (5, 2, 13, wpe / "WPEGPUProcess"),
                (6, 2, 14, root / "foreign/WPEWebProcess"),
                (7, 2, 15, wpe / "WPEWebProcess.unknown"),
            ]
            for pid, parent, start, exe in children:
                folder = proc / str(pid)
                folder.mkdir(parents=True)
                fields = ["S", str(parent), *["0"] * 17, str(start), "0", "10"]
                (folder / "stat").write_text(f"{pid} (fixture) " + " ".join(fields))
                if exe is not None:
                    exe.parent.mkdir(parents=True, exist_ok=True)
                    exe.touch()
                    (folder / "exe").symlink_to(exe)
            (proc / "3/cgroup").write_text("0::/job.slice/content.scope\n")
            tracker = observer.Observer(webkit)
            with (patch.object(observer, "PROC", proc), patch.object(observer, "CGROUP", cgroup),
                  patch.object(observer, "boottime_us", return_value=100)):
                tracker.sample(1, 1, 100)
                self.assertEqual(tracker.scopes()["webContent"]["end"]["currentBytes"], 123456)
            self.assertEqual({row["pid"]: row["role"] for row in tracker.records.values()}, {
                2: "MiniBrowser", 3: "WebKitWebProcess", 4: "WebKitNetworkProcess", 5: "WebKitGPUProcess",
            })
            self.assertEqual(tracker.content_scope_status, "mapped")
            self.assertEqual(tracker.content_baseline["scope"], "local")

    def test_original_gtk_executable_roles_remain_exact(self):
        for role in ("MiniBrowser", "WebKitWebProcess", "WebKitNetworkProcess", "WebKitGPUProcess"):
            with patch.object(observer.os, "readlink", return_value=str(ROOT / "minibrowser-gtk/bin" / role)):
                self.assertEqual(observer.executable_role(123, ROOT), role)

    def test_only_owned_pid_lifetime_and_same_boot_qualify(self):
        self.assertEqual(observer.correlate("observed", [event()], [process()], BOOT, 0, 100, None), {
            "status": "OWNED_NATIVE_EVENT",
            "ownedProcessEvents": [{"kind": "oom-victim", "pid": 123, "atUs": 25, "startTicks": 100}],
        })
        reused = process(start=201, first=70, last=80, absent=85)
        for native in (event(pid=999), event(boot="b" * 32), event(at=55), event(at=90)):
            self.assertEqual(observer.correlate("observed", [native], [process(), reused], BOOT, 0, 100, None)["status"], "UNKNOWN")
        overlap = process(pid=124)
        self.assertEqual(observer.correlate("observed", [event()], [process(), overlap], BOOT, 0, 100, None)["status"], "UNKNOWN")
        late = observer.correlate("observed", [event(at=75)], [process(), reused], BOOT, 0, 100, None)
        self.assertEqual(late["ownedProcessEvents"][0]["startTicks"], 201)
        native = event(message="traps: WebKitWebProces[123] trap invalid opcode ip:1")
        self.assertEqual(observer.correlate("observed", [native], [process()], BOOT, 0, 100, None)["ownedProcessEvents"][0]["kind"], "native-fault")

    def test_missing_journal_permission_or_malformed_row_remains_unknown(self):
        status, rows = observer.decode_journal(1, b"No journal files were opened due to insufficient permissions.")
        self.assertEqual(status, "unavailable-permission")
        self.assertEqual(observer.correlate(status, rows, [process()], BOOT, 0, 100, None)["status"], "UNKNOWN")
        self.assertIsNone(observer.kernel_event({"_BOOT_ID": None}, BOOT))

    def test_unseen_pid_reuse_in_gap_and_boundary_never_qualify(self):
        owner = process()
        for at in (10, 30, 31, 39, 40):
            native = event(at=at)
            self.assertEqual(observer.correlate("observed", [native], [owner], BOOT, 0, 100, None)["status"], "UNKNOWN")

    def test_main_retains_unqualified_oom_tail_without_claiming_process_identity(self):
        commit = "1" * 40
        env = {"ZK682_EXPECTED_COMMIT": commit, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
        rows = [event(at=39), event(pid=999, at=39), {**event(at=39), "SYSLOG_FACILITY": "1"}]

        def child(_argv, tracker):
            tracker.records[(123, 100)] = process()
            return 0

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            boot = root / "sys/kernel/random/boot_id"
            boot.parent.mkdir(parents=True)
            boot.write_text(BOOT)
            artifact = root / "result.json"
            with (patch.dict(os.environ, env), patch.object(observer.sys, "platform", "linux"),
                  patch.object(observer, "PROC", root), patch.object(observer, "OUTPUT", artifact),
                  patch.object(observer, "boottime_us", side_effect=[0, 100]),
                  patch.object(observer, "journal_window", return_value=("observed", rows)),
                  patch.object(observer, "run_child", side_effect=child)):
                self.assertEqual(observer.main(["--", *observer.expected_command(commit)]), 0)
            serialized = artifact.read_text()
        output = json.loads(serialized)
        self.assertEqual(output["nativeEvidence"], {"status": "UNKNOWN", "ownedProcessEvents": []})
        self.assertEqual(output["journalEvidence"], {
            "queriedRows": 3, "rejectedRows": 3,
            "unqualifiedPidCandidates": [
                {"kind": "oom-victim", "pid": 123, "atUs": 39, "status": "UNQUALIFIED", "reason": "no-proved-owned-lifetime"}
            ],
        })
        self.assertNotIn("Out of memory: Killed process", serialized)

    def test_later_same_start_zombie_stat_extends_only_confirmed_life(self):
        tracker = observer.Observer(ROOT)
        tracker.see(123, observer.ProcStat(6, 100, 7), "WebKitWebProcess", 9, 10)
        with patch.object(observer, "read_proc", return_value=observer.ProcStat(1, 100, 0)), patch.object(observer, "boottime_us", return_value=37):
            tracker.refresh_absence()
        with patch.object(observer, "read_proc", return_value=observer.ProcStat(7, 150, 0)), patch.object(observer, "boottime_us", side_effect=[40, 41]):
            tracker.refresh_absence()
        row = tracker.records[(123, 100)]
        self.assertEqual((row["lastSeenUs"], row["lastConfirmedUs"], row["firstAbsentUs"]), (10, 37, 41))
        self.assertEqual(observer.correlate("observed", [event(at=35)], [row], BOOT, 0, 100, None)["status"], "OWNED_NATIVE_EVENT")
        self.assertEqual(observer.correlate("observed", [event(at=39)], [row], BOOT, 0, 100, None)["status"], "UNKNOWN")

    def test_receipt_clock_and_untrusted_kernel_facility_never_qualify(self):
        native = event()
        native["__MONOTONIC_TIMESTAMP"] = "25"
        del native["_SOURCE_BOOTTIME_TIMESTAMP"]
        for wrong in (native, {**event(), "_SOURCE_BOOTTIME_TIMESTAMP": "bad"},
                      {**event(), "_TRANSPORT": "syslog"}, {**event(), "SYSLOG_FACILITY": "1"}):
            self.assertEqual(observer.correlate("observed", [wrong], [process()], BOOT, 0, 100, None)["status"], "UNKNOWN")

    def test_cgroup_oom_delta_alone_does_not_name_a_victim(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "memory.events.local").write_text("oom 2\noom_kill 1\n")
            (root / "memory.current").write_text("100\n")
            (root / "memory.max").write_text("max\n")
            baseline = observer.cgroup_snapshot(root)
            (root / "memory.events.local").write_text("oom 2\noom_kill 2\n")
            end = observer.cgroup_snapshot(root)
        self.assertEqual(end["scope"], "local")
        self.assertEqual(end["scopeId"], baseline["scopeId"])
        self.assertEqual(end["events"]["oom_kill"] - baseline["events"]["oom_kill"], 1)
        status, rows = observer.decode_journal(0, b"")
        self.assertEqual(observer.correlate(status, rows, [process()], BOOT, 0, 100, None)["status"], "UNKNOWN")

    def test_limits_leave_positive_looking_partial_data_unqualified(self):
        tracker = observer.Observer(ROOT)
        with patch.object(observer, "MAX_IDENTITIES", 1):
            tracker.see(123, observer.ProcStat(6, 100, 7), "WebKitWebProcess", 9, 10)
            with self.assertRaisesRegex(observer.ObservationLimit, "process-identities"):
                tracker.see(124, observer.ProcStat(6, 101, 7), "WebKitWebProcess", 11, 12)
        self.assertEqual(set(tracker.records), {(123, 100)})
        tracker.samples = observer.MAX_SAMPLES
        with self.assertRaisesRegex(observer.ObservationLimit, "sample-count"):
            tracker.sample(1, 1, 120)
        self.assertEqual(observer.correlate("observed", [event()], [process()], BOOT, 0, 100, "process-identities")["status"], "UNKNOWN")
        with patch.object(observer, "MAX_JOURNAL_BYTES", 2):
            self.assertEqual(observer.decode_journal(0, b"123")[0], "partial-limit")

    def test_original_embedded_red_is_separate_from_wrapper_exit_zero(self):
        commit = "1" * 40
        raw = {"schemaVersion": 1, "kind": "command-receipt", "receiptId": "browser-supported",
               "candidateCommit": commit, "exitCode": 1, "passed": False}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            path.write_text(json.dumps(raw))
            self.assertEqual(observer.embedded_receipt(path, commit), {"status": "observed", "exitCode": 1, "passed": False})
            self.assertEqual(observer.embedded_receipt(path, "2" * 40), {"status": "unqualified"})
        self.assertEqual(observer.propagate(0), 0)

    def test_real_child_exit_and_signal_survive_partial_observation(self):
        class Partial:
            partial_reason = None

            def begin(self, pid):
                raise observer.ObservationLimit("fixture-cap")

            def refresh_absence(self):
                pass

        tracker = Partial()
        self.assertEqual(observer.run_child([sys.executable, "-c", "raise SystemExit(7)"], tracker), 7)
        self.assertEqual(tracker.partial_reason, "fixture-cap")
        kill = "import os, signal; os.kill(os.getpid(), signal.SIGTERM)"
        code = observer.run_child([sys.executable, "-c", kill], tracker)
        self.assertEqual(code, -signal.SIGTERM)
        helper = str(HELPER.resolve())
        driver = "import runpy; runpy.run_path(" + repr(helper) + ")['propagate'](" + str(code) + ")"
        result = subprocess.run([sys.executable, "-c", driver], timeout=3, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(result.returncode, -signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
