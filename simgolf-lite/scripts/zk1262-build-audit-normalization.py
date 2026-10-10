"""One-shot declared audit normalization. Import is inert; ROOT owns integration.

Capture/build/normalize must share one process so captured descriptors stay live.
This preserves only a known generated file, never arbitrary checkout dirt. It is
not a cross-process lock: observed ownership/source races refuse eligibility.
"""
import base64
import hashlib
import json
import os
import selectors
import stat
import subprocess
import time
from dataclasses import dataclass

AUDIT = "simgolf-lite/artifacts/m35/asset-audit.json"
BASE = "b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025"
FILE_CAP = 65536
STATUS_CAP = 16384
RECEIPT_CAP = 32768
GIT_CAP = 65536
GIT_SECONDS = 10


class Refusal(RuntimeError):
    pass


@dataclass(frozen=True)
class Pin:
    path: str
    size: int
    sha256: str
    mode: int = 0o644


@dataclass(frozen=True)
class Policy:
    candidate: str
    baseline: Pin
    protected: tuple


def registered_policy():
    """Exact admitted b7 policy; a later candidate needs fresh ROOT admission."""
    return Policy(BASE, Pin(AUDIT, 7306,
        "6d236fa40b3bfba6aa6714eb7c9b77eb2ee51eb264002deec5697c8a18568176"), (
        Pin("simgolf-lite/package.json", 11208, "6bdbf6af0dca94b79d3025f73b4558ed555b243e03c2ef0ef8c6f42530cdf951"),
        Pin("simgolf-lite/playwright.config.ts", 697, "35d7a3e1c5bf4c00508ff1cfd2510a2bc1306c3243eacac924a9b0940327a948"),
        Pin("simgolf-lite/e2e/zk682-resource-growth.e2e.ts", 15221, "cd238c429bb3c4745b903124442409ad1309e5f6a368ddbf81cd376c2f907142"),
        Pin("simgolf-lite/e2e/zk682-stability.e2e.ts", 17333, "c45b0cf36a725fbe4da0de4877cdac016e29c334f63f1a3b674edfb20bdd2a45"),
        Pin("simgolf-lite/scripts/zk682-run-resource-growth.mjs", 2105, "49206a32a5d47386e4695098cf53b06812d1f352745752dd7fd2be7ecedf48a2"),
        Pin("simgolf-lite/scripts/zk682-run-stability.mjs", 1790, "43587e0f25cba83c3fe0f16884a91e291cf7bce7e813bd5c9a9805e038393647"),
        Pin("simgolf-lite/scripts/m35-asset-audit.mjs", 13750, "37e4f5776c15b9e935e6475fb4abdb0ed67a4cb804dda2da67806d30d86e9604"),
    ))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def identity(info):
    return (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode))


def regular(info):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Refusal("regular single-link file required")


def read_fd(fd, cap=FILE_CAP):
    before = os.fstat(fd)
    regular(before)
    if before.st_size > cap:
        raise Refusal("file byte cap")
    data = os.pread(fd, cap + 1, 0)
    after = os.fstat(fd)
    if (identity(before), before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            identity(after), after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise Refusal("file changed during read")
    if len(data) != before.st_size or len(data) > cap:
        raise Refusal("file read incomplete or oversize")
    return data


def git(repo, *args, cap=GIT_CAP):
    """Bound both pipes while reading; never refresh index or invoke fsmonitor."""
    command = ["git", "--no-optional-locks", "-c", "core.fsmonitor=false",
               "-c", "core.untrackedCache=false", "-c", "core.filemode=true",
               "-C", repo, *args]
    started = time.monotonic()
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    result = {"out": bytearray(), "err": bytearray()}
    try:
        selector.register(child.stdout, selectors.EVENT_READ, "out")
        selector.register(child.stderr, selectors.EVENT_READ, "err")
        total = 0
        while selector.get_map():
            remaining = GIT_SECONDS - (time.monotonic() - started)
            if remaining <= 0:
                raise Refusal("git deadline")
            for key, _ in selector.select(min(remaining, 0.1)):
                chunk = os.read(key.fileobj.fileno(), min(4096, cap - total + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                if total > cap:
                    raise Refusal("git output cap; status coverage UNKNOWN")
                result[key.data].extend(chunk)
        remaining = GIT_SECONDS - (time.monotonic() - started)
        if remaining <= 0:
            raise Refusal("git deadline")
        code = child.wait(timeout=remaining)
        if time.monotonic() - started > GIT_SECONDS:
            raise Refusal("git late completion")
        if code:
            raise Refusal("git refusal: " + bytes(result["err"]).decode("utf8", "replace")[:512])
        return bytes(result["out"])
    finally:
        selector.close()
        if child.poll() is None:
            child.kill()
        child.wait(timeout=2)
        child.stdout.close()
        child.stderr.close()


class AuditOwner:
    """Explicit owner; no default calls, file selectors, build launch or rollback."""
    def __init__(self, repo, evidence, policy, phase_hook=None):
        self.repo = os.path.abspath(os.fspath(repo))
        self.evidence = os.path.abspath(os.fspath(evidence))
        self.policy = policy
        self.phase_hook = phase_hook  # injected mutation/failure seam for ROOT controls
        self.dirs = {}
        self.files = {}
        self.spent = False
        self.restoration_attempted = False
        self.normalized = False
        self.failed = False
        self.first_error = None
        self.last_status = b""
        self.status_complete = False
        self.evidence_fd = None
        try:
            if os.path.realpath(self.repo) != self.repo or os.path.realpath(os.path.dirname(self.evidence)) != os.path.dirname(self.evidence):
                raise Refusal("canonical real directories required")
            if os.path.commonpath([self.repo, self.evidence]) == self.repo:
                raise Refusal("evidence must be outside checkout")
            if len(policy.candidate) != 40 or any(c not in "0123456789abcdef" for c in policy.candidate):
                raise Refusal("exact candidate SHA required")
            if policy.baseline.path != AUDIT or not policy.protected:
                raise Refusal("fixed audit and protected source pins required")
            self._directory(self.repo)
            os.mkdir(self.evidence, 0o700)  # fresh, exclusive owner namespace
            self.evidence_fd = self._directory(self.evidence)
            paths = [pin.path for pin in (policy.baseline, *policy.protected)]
            if len(paths) != len(set(paths)):
                raise Refusal("duplicate protected path")
            for pin in (policy.baseline, *policy.protected):
                self._capture_file(pin, writable=pin.path == AUDIT)
            self._guard(False)
            committed = git(self.repo, "show", f"HEAD:{AUDIT}")
            self.baseline = read_fd(self.files[AUDIT][0])
            if committed != self.baseline:
                raise Refusal("working baseline differs from committed blob")
            index = git(self.repo, "ls-files", "--stage", "-z", "--", AUDIT)
            if not index.startswith(b"100644 ") or index.count(b"\0") != 1 or b" 0\t" + AUDIT.encode() + b"\0" not in index:
                raise Refusal("audit index mode/stage/path")
            self._publish("baseline-audit.json", self.baseline)
            self._publish("before.json", self._receipt("BEFORE_CAPTURED"))
        except BaseException as error:
            self._fail(error, "before-failure.json")
            self.close()
            raise

    def _directory(self, absolute):
        if absolute in self.dirs:
            return self.dirs[absolute][0]
        parts = absolute.split(os.sep)
        current = os.sep
        fd = os.open(current, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in parts:
                if not part:
                    continue
                new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = new
                current = os.path.join(current, part)
            info = os.fstat(fd)
            if identity(os.stat(absolute, follow_symlinks=False)) != identity(info):
                raise Refusal("directory changed while opening")
            self.dirs[absolute] = (fd, identity(info))
            return fd
        except BaseException:
            os.close(fd)
            raise

    def _capture_file(self, pin, writable):
        parts = pin.path.split("/")
        if any(p in ("", ".", "..") for p in parts) or pin.path.startswith("/") or pin.size > FILE_CAP:
            raise Refusal("invalid declared source path/size")
        parent = self.repo
        for part in parts[:-1]:
            parent = os.path.join(parent, part)
            self._directory(parent)
        directory = self._directory(parent)
        fd = os.open(parts[-1], (os.O_RDWR if writable else os.O_RDONLY) | os.O_NOFOLLOW, dir_fd=directory)
        try:
            info = os.fstat(fd)
            regular(info)
            if identity(os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)) != identity(info):
                raise Refusal("file identity changed while opening")
            data = read_fd(fd)
            if len(data) != pin.size or sha(data) != pin.sha256 or stat.S_IMODE(info.st_mode) != pin.mode:
                raise Refusal("source pin bytes/hash/mode mismatch: " + pin.path)
            self.files[pin.path] = (fd, identity(info), parent, parts[-1], pin)
        except BaseException:
            os.close(fd)
            raise

    def _physical(self):
        for name, (fd, expected) in self.dirs.items():
            if os.path.realpath(name) != name or identity(os.fstat(fd)) != expected or identity(os.stat(name, follow_symlinks=False)) != expected:
                raise Refusal("directory ownership drift: " + name)
        for name, (fd, expected, parent, leaf, pin) in self.files.items():
            info = os.fstat(fd)
            regular(info)
            located = os.stat(leaf, dir_fd=self.dirs[parent][0], follow_symlinks=False)
            regular(located)
            if identity(info) != expected or identity(located) != expected or stat.S_IMODE(info.st_mode) != pin.mode:
                raise Refusal("file ownership/mode drift: " + name)

    def _guard(self, audit_change):
        self._physical()
        if git(self.repo, "rev-parse", "--verify", "HEAD").strip().decode("ascii") != self.policy.candidate:
            raise Refusal("HEAD drift")
        status = git(self.repo, "status", "--porcelain=v1", "-z", "--untracked-files=all", cap=STATUS_CAP)
        self.last_status = status
        self.status_complete = True
        allowed = b" M " + AUDIT.encode() + b"\0"
        if status and (not audit_change or status != allowed):
            raise Refusal("whole tracked/staged/untracked status is not the declared audit-only change")
        for pin in self.policy.protected:
            data = read_fd(self.files[pin.path][0])
            if len(data) != pin.size or sha(data) != pin.sha256:
                raise Refusal("protected source drift: " + pin.path)
        if not audit_change:
            data = read_fd(self.files[AUDIT][0])
            if len(data) != self.policy.baseline.size or sha(data) != self.policy.baseline.sha256:
                raise Refusal("baseline audit drift")
        self._physical()

    def _publish(self, name, data):
        if not isinstance(data, bytes):
            data = (json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
        if len(data) > (FILE_CAP if name.endswith("audit.json") else RECEIPT_CAP):
            raise Refusal("evidence byte cap")
        self._evidence_physical()
        fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.evidence_fd)
        try:
            regular(os.fstat(fd))
            written = 0
            while written < len(data):
                count = os.write(fd, data[written:])
                if count <= 0:
                    raise Refusal("evidence short write")
                written += count
            os.fsync(fd)
            if read_fd(fd) != data or identity(os.stat(name, dir_fd=self.evidence_fd, follow_symlinks=False)) != identity(os.fstat(fd)):
                raise Refusal("preservation verification failed")
            os.fsync(self.evidence_fd)
            self._evidence_physical()
        finally:
            os.close(fd)

    def _evidence_physical(self):
        if self.evidence_fd is None or os.path.realpath(self.evidence) != self.evidence:
            raise Refusal("evidence owner unavailable or aliased")
        expected = self.dirs[self.evidence][1]
        if identity(os.fstat(self.evidence_fd)) != expected or identity(os.stat(self.evidence, follow_symlinks=False)) != expected:
            raise Refusal("evidence directory ownership drift")

    def _receipt(self, status):
        rows = []
        for name, (fd, expected, parent, _, pin) in self.files.items():
            info = os.fstat(fd)
            rows.append({"path": name, "dev": expected[0], "inode": expected[1], "mode": stat.S_IMODE(info.st_mode), "nlink": info.st_nlink, "parent": parent})
        return {"status": status, "candidate": self.policy.candidate, "audit": AUDIT,
                "statusNulBase64": base64.b64encode(self.last_status).decode(),
                "statusBytes": len(self.last_status), "statusSha256": sha(self.last_status),
                "statusComplete": self.status_complete,
                "physical": rows, "directories": [{"path": p, "dev": row[1][0], "inode": row[1][1]} for p, row in self.dirs.items()],
                "spent": self.spent, "restorationAttempted": self.restoration_attempted,
                "normalized": self.normalized, "failed": self.failed,
                "firstError": repr(self.first_error)[:2048] if self.failed else None}

    def _fail(self, error, name):
        if not self.failed:
            self.failed = True
            self.first_error = error
        if self.evidence_fd is not None:
            try:
                try:
                    self.last_status = git(self.repo, "status", "--porcelain=v1", "-z", "--untracked-files=all", cap=STATUS_CAP)
                    self.status_complete = True
                except BaseException:
                    self.status_complete = False
                self._publish(name, self._receipt("FAIL_PRODUCER_BLOCKED"))
            except BaseException:
                pass  # Original cause survives failed/colliding evidence; ROOT outer receipt records it.

    def _hook(self, phase):
        if self.phase_hook is not None:
            self.phase_hook(phase, self)

    def normalize(self, build_succeeded):
        if self.spent or self.failed:
            error = Refusal("normalization allowance already consumed or failed")
            self._fail(error, "repeated-normalization-failure.json")
            raise error
        self.spent = True  # Consume before any preservation/restoration attempt.
        try:
            if build_succeeded is not True:
                raise Refusal("successful build proof required")
            self._hook("before_preserve")
            self._guard(True)
            generated = read_fd(self.files[AUDIT][0])
            self._publish("generated-audit.json", generated)
            self._publish("generated.json", {**self._receipt("GENERATED_PRESERVED"), "generatedBytes": len(generated), "generatedSha256": sha(generated), "baselineBytes": len(self.baseline), "baselineSha256": sha(self.baseline)})
            self._hook("before_restore")
            self._guard(True)
            if read_fd(self.files[AUDIT][0]) != generated:
                raise Refusal("generated audit changed after preservation")
            if generated != self.baseline:
                fd = self.files[AUDIT][0]
                self._physical()
                self.restoration_attempted = True
                written = 0
                while written < len(self.baseline):
                    count = os.pwrite(fd, self.baseline[written:], written)
                    if count <= 0:
                        raise Refusal("baseline short write")
                    written += count
                os.ftruncate(fd, len(self.baseline))
                os.fsync(fd)
            self._guard(False)
            self.normalized = True
            self._publish("normalized.json", self._receipt("NOOP_BASELINE_CLEAN" if generated == self.baseline else "BASELINE_RESTORED_ONCE"))
            return {"producerEligible": True, "restored": self.restoration_attempted}
        except BaseException as error:
            self._fail(error, "normalization-failure.json")
            raise

    def finish(self):
        """Strict final guard only. This method can never restore any bytes."""
        try:
            if not self.normalized or self.failed:
                raise Refusal("successful one-shot normalization required")
            self._guard(False)
            self._publish("final.json", self._receipt("FINAL_STRICT_CLEAN"))
            return {"finalSourceEligible": True}
        except BaseException as error:
            self._fail(error, "final-failure.json")
            raise

    def close(self):
        """Release only captured descriptors; no path cleanup or second restore."""
        for row in self.files.values():
            try:
                os.close(row[0])
            except OSError:
                pass
        self.files.clear()
        for row in self.dirs.values():
            try:
                os.close(row[0])
            except OSError:
                pass
        self.dirs.clear()
        self.evidence_fd = None
