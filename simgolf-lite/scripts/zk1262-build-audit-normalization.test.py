"""ROOT-only focused temporary Git/filesystem controls, not an actual build."""
import hashlib
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

MODULE = os.environ["ZK1262_NORMALIZER_MODULE"]
EXPECTED_SHA = os.environ["ZK1262_NORMALIZER_MODULE_SHA256"]
OUT = Path(os.environ["ZK1262_NORMALIZER_TEST_OUT"])
if OUT.exists():
    raise RuntimeError("fresh ROOT-owned test output required")
OUT.mkdir(mode=0o700)
raw_module = Path(MODULE).read_bytes()
if len(raw_module) > 32768 or hashlib.sha256(raw_module).hexdigest() != EXPECTED_SHA:
    raise RuntimeError("actual module binding mismatch")
spec = importlib.util.spec_from_file_location("zk1262_normalizer_control_target", MODULE)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


def command(repo, *args):
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(repo), *args],
        capture_output=True, timeout=10, check=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "normalizer-test", "GIT_AUTHOR_EMAIL": "test@invalid",
             "GIT_COMMITTER_NAME": "normalizer-test", "GIT_COMMITTER_EMAIL": "test@invalid"})
    if len(result.stdout) + len(result.stderr) > 65536:
        raise RuntimeError("fixture git output cap")
    return result.stdout


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(dir=OUT)
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.audit = self.repo / m.AUDIT
        self.audit.parent.mkdir(parents=True)
        self.baseline = b'{"baseline":"committed"}\n'
        self.generated = b'{"generated":"successful-build-output"}\n'
        self.audit.write_bytes(self.baseline)
        self.audit.chmod(0o644)
        self.protected = []
        for i, real in enumerate(m.registered_policy().protected):
            target = self.repo / real.path
            target.parent.mkdir(parents=True, exist_ok=True)
            data = f"frozen-protected-source-{i}\n".encode()
            target.write_bytes(data)
            target.chmod(0o644)
            self.protected.append(m.Pin(real.path, len(data), m.sha(data)))
        (self.repo / ".gitignore").write_text("simgolf-lite/dist/\n")
        (self.repo / "sentinel.txt").write_bytes(b"never restore me\n")
        command(self.repo, "init", "-q")
        command(self.repo, "add", ".")
        command(self.repo, "commit", "-qm", "owned synthetic baseline")
        candidate = command(self.repo, "rev-parse", "HEAD").strip().decode()
        self.policy = m.Policy(candidate, m.Pin(m.AUDIT, len(self.baseline), m.sha(self.baseline)), tuple(self.protected))
        self.evidence = self.base / "evidence"
        self.owner = None

    def capture(self, hook=None):
        self.owner = m.AuditOwner(self.repo, self.evidence, self.policy, hook)
        return self.owner

    def generate(self):
        self.audit.write_bytes(self.generated)  # Same inode, as admitted writeFileSync writer.

    def close(self):
        if self.owner:
            self.owner.close()
        self.temp.cleanup()


class Tests(unittest.TestCase):
    def setUp(self):
        self.fixtures = []

    def tearDown(self):
        for fixture in reversed(self.fixtures):
            fixture.close()

    def fixture(self):
        fixture = Fixture()
        self.fixtures.append(fixture)
        return fixture

    def refuse(self, owner):
        with self.assertRaises(Exception):
            owner.normalize(True)
        self.assertFalse(owner.normalized)
        self.assertTrue(owner.failed)
        self.assertFalse(owner.restoration_attempted)

    def test_01_audit_only_preserved_then_exact_owned_baseline(self):
        f = self.fixture(); owner = f.capture(); inode = f.audit.stat().st_ino
        f.generate()
        self.assertEqual(owner.normalize(True), {"producerEligible": True, "restored": True})
        self.assertEqual(f.audit.read_bytes(), f.baseline)
        self.assertEqual(f.audit.stat().st_ino, inode)
        self.assertEqual(f.audit.stat().st_mode & 0o777, 0o644)
        self.assertEqual((f.evidence / "baseline-audit.json").read_bytes(), f.baseline)
        self.assertEqual((f.evidence / "generated-audit.json").read_bytes(), f.generated)
        generated = json.loads((f.evidence / "generated.json").read_bytes())
        self.assertEqual(generated["generatedSha256"], m.sha(f.generated))
        self.assertEqual(base64.b64decode(generated["statusNulBase64"]), b" M " + m.AUDIT.encode() + b"\0")
        self.assertEqual(owner.finish(), {"finalSourceEligible": True})

    def test_02_noop_consumes_allowance_and_repetition_blocks(self):
        f = self.fixture(); owner = f.capture()
        self.assertEqual(owner.normalize(True), {"producerEligible": True, "restored": False})
        self.assertEqual(json.loads((f.evidence / "normalized.json").read_bytes())["status"], "NOOP_BASELINE_CLEAN")
        with self.assertRaises(m.Refusal): owner.normalize(True)
        with self.assertRaises(m.Refusal): owner.finish()
        self.assertEqual(f.audit.read_bytes(), f.baseline)

    def test_03_initial_dirty_refuses_before_capture(self):
        f = self.fixture(); f.generate()
        with self.assertRaises(Exception): f.capture()
        self.assertEqual(f.audit.read_bytes(), f.generated)
        self.assertFalse((f.evidence / "baseline-audit.json").exists())

    def test_04_literal_success_only(self):
        for success in (False, None, 0, 1, "true"):
            with self.subTest(success=success):
                f = self.fixture(); owner = f.capture(); f.generate()
                with self.assertRaises(m.Refusal): owner.normalize(success)
                self.assertFalse(owner.restoration_attempted)
                self.assertEqual(f.audit.read_bytes(), f.generated)

    def test_05_extra_tracked_staged_and_NULsafe_untracked_refuse(self):
        for kind in ("tracked", "staged-audit", "untracked-newline"):
            with self.subTest(kind=kind):
                f = self.fixture(); owner = f.capture(); f.generate()
                if kind == "tracked": (f.repo / "sentinel.txt").write_bytes(b"foreign edit\n")
                if kind == "staged-audit": command(f.repo, "add", "--", m.AUDIT)
                if kind == "untracked-newline": (f.repo / "extra\nname.txt").write_bytes(b"foreign\n")
                self.refuse(owner)
                self.assertEqual(f.audit.read_bytes(), f.generated)
                self.assertTrue(json.loads((f.evidence / "normalization-failure.json").read_bytes())["statusComplete"])

    def test_06_ignored_build_directory_remains_ignored(self):
        f = self.fixture(); owner = f.capture(); f.generate()
        dist = f.repo / "simgolf-lite/dist"; dist.mkdir()
        (dist / "generated.js").write_bytes(b"ignored original build output")
        self.assertTrue(owner.normalize(True)["producerEligible"])
        self.assertTrue(owner.finish()["finalSourceEligible"])

    def test_07_HEAD_drift_refuses(self):
        f = self.fixture(); owner = f.capture(); f.generate()
        command(f.repo, "commit", "--allow-empty", "-qm", "foreign HEAD")
        self.refuse(owner)
        self.assertEqual(f.audit.read_bytes(), f.generated)

    def test_08_hidden_source_drift_and_samebyte_inode_swap_refuse(self):
        for kind in ("hidden-hash", "inode"):
            with self.subTest(kind=kind):
                f = self.fixture(); owner = f.capture(); f.generate()
                pin = f.protected[0]; target = f.repo / pin.path
                if kind == "hidden-hash":
                    command(f.repo, "update-index", "--assume-unchanged", "--", pin.path)
                    target.write_bytes(b"changed protected source")
                else:
                    data = target.read_bytes(); target.rename(target.with_name("saved-foreign-inode")); target.write_bytes(data)
                self.refuse(owner)
                self.assertEqual(f.audit.read_bytes(), f.generated)

    def test_09_rename_delete_mode_symlink_type_refuse_sentinel(self):
        for kind in ("rename", "delete", "mode", "symlink", "directory"):
            with self.subTest(kind=kind):
                f = self.fixture(); owner = f.capture(); f.generate()
                sentinel = f.base / "external-sentinel"; sentinel.write_bytes(b"DO NOT TOUCH")
                if kind == "rename": f.audit.rename(f.audit.with_name("renamed.json"))
                elif kind == "mode": f.audit.chmod(0o600)
                else:
                    f.audit.unlink()
                    if kind == "symlink": f.audit.symlink_to(sentinel)
                    if kind == "directory": f.audit.mkdir()
                self.refuse(owner)
                self.assertEqual(sentinel.read_bytes(), b"DO NOT TOUCH")

    def test_10_hardlink_audit_or_protected_refuse(self):
        for target_name in (m.AUDIT, "simgolf-lite/package.json"):
            with self.subTest(path=target_name):
                f = self.fixture(); owner = f.capture(); f.generate()
                alias = f.base / "alias"; os.link(f.repo / target_name, alias)
                expected = alias.read_bytes(); self.refuse(owner)
                self.assertEqual(alias.read_bytes(), expected)
                self.assertEqual(f.audit.read_bytes(), f.generated)

    def test_11_parent_replacement_before_restore_never_writes_foreign_path(self):
        f = self.fixture()
        def hook(phase, _):
            if phase == "before_restore":
                parent = f.audit.parent; parent.rename(parent.with_name("old-owned-parent")); parent.mkdir()
                f.audit.write_bytes(b"FOREIGN TARGET")
        owner = f.capture(hook); f.generate(); self.refuse(owner)
        self.assertEqual(f.audit.read_bytes(), b"FOREIGN TARGET")
        self.assertEqual((f.evidence / "generated-audit.json").read_bytes(), f.generated)

    def test_12_changed_generated_after_preservation_refuses(self):
        f = self.fixture()
        def hook(phase, _):
            if phase == "before_restore": f.audit.write_bytes(b"late foreign bytes")
        owner = f.capture(hook); f.generate(); self.refuse(owner)
        self.assertEqual(f.audit.read_bytes(), b"late foreign bytes")
        self.assertEqual((f.evidence / "generated-audit.json").read_bytes(), f.generated)

    def test_13_oversize_and_exclusive_preservation_collision_refuse(self):
        for kind in ("oversize", "collision", "preserve-fsync-failure"):
            with self.subTest(kind=kind):
                f = self.fixture(); owner = f.capture(); f.generate()
                if kind == "oversize": f.audit.write_bytes(b"x" * (m.FILE_CAP + 1))
                elif kind == "collision": (f.evidence / "generated-audit.json").write_bytes(b"foreign artifact")
                expected = f.audit.read_bytes()
                if kind == "preserve-fsync-failure":
                    with patch.object(m.os, "fsync", side_effect=OSError("injected preserve fsync failure")):
                        self.refuse(owner)
                else: self.refuse(owner)
                self.assertEqual(f.audit.read_bytes(), expected)
                if kind == "collision": self.assertEqual((f.evidence / "generated-audit.json").read_bytes(), b"foreign artifact")

    def test_14_restoration_IO_failure_blocks_producer_without_rollback(self):
        f = self.fixture(); owner = f.capture(); f.generate()
        with patch.object(m.os, "pwrite", side_effect=OSError("injected descriptor write failure")):
            with self.assertRaises(OSError): owner.normalize(True)
        self.assertTrue(owner.restoration_attempted)
        self.assertFalse(owner.normalized)
        self.assertEqual(f.audit.read_bytes(), f.generated)
        self.assertEqual((f.evidence / "generated-audit.json").read_bytes(), f.generated)

    def test_15_final_mutation_strictly_fails_without_second_restore(self):
        f = self.fixture(); owner = f.capture(); f.generate(); owner.normalize(True)
        later = b"producer mutation remains"; f.audit.write_bytes(later)
        with self.assertRaises(m.Refusal): owner.finish()
        self.assertEqual(f.audit.read_bytes(), later)
        self.assertFalse((f.evidence / "final.json").exists())
        self.assertEqual(json.loads((f.evidence / "final-failure.json").read_bytes())["status"], "FAIL_PRODUCER_BLOCKED")

    def test_16_falsey_first_error_identity_survives_later_failure(self):
        class FalseyError(Exception):
            def __bool__(self): return False
        token = FalseyError("exact primary")
        f = self.fixture()
        def hook(phase, _):
            if phase == "before_preserve": raise token
        owner = f.capture(hook); f.generate()
        with self.assertRaises(FalseyError): owner.normalize(True)
        self.assertIs(owner.first_error, token)
        with self.assertRaises(m.Refusal): owner.finish()
        self.assertIs(owner.first_error, token)
        self.assertEqual(f.audit.read_bytes(), f.generated)

    def test_17_evidence_parent_drift_refuses_without_restore(self):
        f = self.fixture(); owner = f.capture(); f.generate()
        f.evidence.rename(f.base / "old-evidence"); f.evidence.mkdir()
        self.refuse(owner)
        self.assertEqual(f.audit.read_bytes(), f.generated)
        self.assertEqual(list(f.evidence.iterdir()), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
