"""Source-only ZK1325 report containment. Activation requires ROOT binding assembly.
Local ownership observations never authenticate hosted identity or native closure.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time

ENV_KEYS = ('PLAYWRIGHT_HTML_OUTPUT_DIR', 'PLAYWRIGHT_HTML_REPORT')
MAX_FILES = 128
MAX_BYTES = 4194304
MAX_ENTRIES = 256
MAX_DEPTH = 16


def require(ok, message):
    if not ok:
        raise ValueError(message)


def devino(s):
    return (s.st_dev, s.st_ino)


def snapshot(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size,
            s.st_mtime_ns, s.st_ctime_ns)


def safe_error(error):
    row = {'type': type(error).__name__[:64], 'message': 'UNKNOWN'}
    try:
        row['message'] = str(error)[:96]
    except BaseException:
        row['formatFailure'] = True
    # Never truth-test or replace the original exception or its falsy cause.
    try:
        attrs = BaseException.__dict__['__dict__'].__get__(error)
        if 'cause' in attrs and type(attrs['cause']) in (type(None), bool, int, str):
            row['causePresent'] = True
            value = attrs['cause']
            if type(value) is int and value.bit_length() > 128:
                row['cause'] = 'UNSERIALIZABLE_INTEGER'
            else:
                row['cause'] = value[:96] if type(value) is str else value
    except BaseException:
        pass
    return row


def encoded(value):
    raw = (json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode()
    require(len(raw) <= 4096, 'report event/metadata cap')
    return raw


def canonical(path):
    p = Path(path)
    require(p.is_absolute() and str(p) == os.path.realpath(p), 'report canonical path')
    return p


class ReportOwner:
    def __init__(self, artifact_root, temp_parent, identity, env, ceiling,
                 clock=time.monotonic, emit=None):
        self.clock = clock
        self.emit = emit if emit is not None else self.stdout
        self.events = []
        self.secondary = []
        self.fds = []
        self.closed = False
        self.ceiling = ceiling
        self.env = env
        self.identity = dict(identity)
        require(set(identity) == {'source', 'candidate', 'run', 'attempt'}, 'report identity keys')
        require(all(type(identity[k]) is str and re.fullmatch('[0-9a-f]{40}', identity[k])
                    for k in ('source', 'candidate')), 'report commit identity')
        require(identity['source'] != identity['candidate'] and type(identity['run']) is int
                and 0 < identity['run'] <= 9007199254740991
                and type(identity['attempt']) is int and identity['attempt'] == 1, 'report run identity')
        self.root = canonical(artifact_root)
        self.parent = canonical(temp_parent)
        require(self.root.parent == self.parent, 'report authenticated temp parent required')
        self.container = self.parent/(self.root.name+'-html-report-owned')
        self.child = self.container/'report'
        self.metadata = self.parent/(self.root.name+'-html-report-owner.json')
        require(env.get('GITHUB_SHA') == identity['source']
                and env.get('GITHUB_RUN_ID') == str(identity['run'])
                and env.get('GITHUB_RUN_ATTEMPT') == str(identity['attempt']), 'report caller identity drift')
        self.original_env = {k: env.get(k) for k in ENV_KEYS}
        require(all(k not in env or env[k] == '' for k in ENV_KEYS), 'foreign report env refused')
        try:
            self.check()
            self.parent_fd = self.open_dir(self.parent)
            self.parent_identity = devino(os.fstat(self.parent_fd))
            self.root_fd = self.open_dir(self.root)
            self.root_identity = devino(os.fstat(self.root_fd))
            require(not os.path.lexists(self.container) and not os.path.lexists(self.metadata), 'existing report ownership refused')
            os.mkdir(self.container.name, 0o700, dir_fd=self.parent_fd)
            self.container_fd = self.open_dir(self.container)
            info = os.fstat(self.container_fd)
            self.container_identity = devino(info)
            require(stat.S_IMODE(info.st_mode) == 0o700, 'report container mode')
            self.guard()
            receipt = {'schema': 1, 'role': 'html-report-owner', 'identity': self.identity,
                       'artifactRoot': str(self.root), 'container': str(self.container),
                       'reportOutput': str(self.child), 'parentDevIno': self.parent_identity,
                       'artifactDevIno': self.root_identity, 'containerDevIno': self.container_identity,
                       'childInitiallyAbsent': True, 'ownershipQualification': 'LOCAL_OBSERVATION_ONLY',
                       'nativeClosure': 'UNKNOWN', 'capFiles': MAX_FILES, 'capBytes': MAX_BYTES}
            fd = os.open(self.metadata.name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                         0o600, dir_fd=self.parent_fd)
            self.fds.append(fd)
            self.metadata_fd = fd
            raw = encoded(receipt)
            off = 0
            while off < len(raw):
                self.check()
                n = os.write(fd, raw[off:])
                require(n > 0, 'metadata short write')
                off += n
            os.fsync(fd)
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == len(raw), 'metadata single-link complete write')
            self.metadata_snapshot = snapshot(info)
            os.fsync(self.parent_fd)
            self.guard()
            require(not os.path.lexists(self.child), 'report child must initially be absent')
            for key in ENV_KEYS:
                env[key] = str(self.child)
        except BaseException as primary:
            try:
                self.close()
            except BaseException as secondary:
                self.secondary.append(safe_error(secondary))
                try:
                    primary.add_note('report constructor descriptor close also failed')
                except BaseException:
                    pass
            raise

    @staticmethod
    def stdout(raw):
        off = 0
        while off < len(raw):
            n = os.write(1, raw[off:])
            require(n > 0, 'report event stdout write')
            off += n

    def check(self, ceiling=None):
        if ceiling is not None:
            self.ceiling = ceiling
        now = self.clock()
        require(type(now) in (int, float) and math.isfinite(now)
                and type(self.ceiling) in (int, float) and math.isfinite(self.ceiling)
                and 0 <= now < self.ceiling and now >= getattr(self, 'last_clock', 0),
                'report original phase deadline/clock drift')
        self.last_clock = now

    def open_dir(self, path):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode), 'report directory type')
        fd = os.open(path, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        self.fds.append(fd)
        require(devino(os.fstat(fd)) == devino(info), 'report directory opened identity')
        return fd

    def guard(self):
        self.check()
        require(self.env.get('GITHUB_SHA') == self.identity['source']
                and self.env.get('GITHUB_RUN_ID') == str(self.identity['run'])
                and self.env.get('GITHUB_RUN_ATTEMPT') == str(self.identity['attempt']), 'report identity env drift')
        for path, fd, identity in ((self.parent, self.parent_fd, self.parent_identity),
                                   (self.root, self.root_fd, self.root_identity),
                                   (self.container, self.container_fd, self.container_identity)):
            require(str(path) == os.path.realpath(path), 'report alias drift')
            a = path.lstat()
            require(stat.S_ISDIR(a.st_mode) and devino(a) == identity
                    and devino(os.fstat(fd)) == identity, 'report directory identity drift')
        require(stat.S_IMODE(os.fstat(self.container_fd).st_mode) == 0o700, 'report container mode drift')
        if hasattr(self, 'metadata_snapshot'):
            require(snapshot(self.metadata.lstat()) == self.metadata_snapshot
                    and snapshot(os.fstat(self.metadata_fd)) == self.metadata_snapshot,
                    'report metadata identity drift')
        for key in ENV_KEYS:
            # The constructor checks before the projection; all later checks are exact.
            if hasattr(self, 'projected'):
                require(self.env.get(key) == str(self.child), 'report env drift')

    def inventory(self):
        self.guard()
        names = []
        with os.scandir(self.container_fd) as scan:
            for entry in scan:
                self.check()
                require(len(names) < 2, 'foreign report container children')
                names.append(entry.name)
        require(set(names) <= {'report'}, 'foreign report container child')
        if not names:
            return {'present': False, 'files': 0, 'bytes': 0, 'entries': [], 'digest': hashlib.sha256(b'').hexdigest()}
        require(stat.S_ISDIR(self.child.lstat().st_mode), 'report child directory required')
        entries = []
        count = total = 0
        def walk(path, depth):
            nonlocal count, total
            self.check()
            require(depth <= MAX_DEPTH and len(entries) < MAX_ENTRIES, 'report tree depth/entries')
            require(str(path) == os.path.realpath(path), 'report child alias')
            a = path.lstat()
            require(a.st_dev == self.container_identity[0], 'report child filesystem')
            if stat.S_ISDIR(a.st_mode):
                fd = os.open(path, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:
                    require(devino(os.fstat(fd)) == devino(a), 'report directory snapshot')
                    children = []
                    with os.scandir(fd) as scan:
                        for entry in scan:
                            self.check()
                            require(len(children) < MAX_ENTRIES, 'report directory fanout')
                            children.append(entry.name)
                    entries.append({'path': str(path.relative_to(self.container)), 'kind': 'dir', 'snap': snapshot(a)})
                    for name in sorted(children):
                        walk(path/name, depth+1)
                    require(snapshot(path.lstat()) == snapshot(a) and snapshot(os.fstat(fd)) == snapshot(a), 'report directory read drift')
                finally:
                    os.close(fd)
            else:
                require(stat.S_ISREG(a.st_mode) and a.st_nlink == 1, 'report regular single-link file')
                count += 1
                total += a.st_size
                require(count <= MAX_FILES and total <= MAX_BYTES, 'report file/byte cap')
                fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW)
                try:
                    require(snapshot(os.fstat(fd)) == snapshot(a), 'report file opened identity')
                    digest = hashlib.sha256()
                    off = 0
                    while off < a.st_size:
                        self.check()
                        raw = os.pread(fd, min(65536, a.st_size-off), off)
                        require(bool(raw), 'report file incomplete')
                        digest.update(raw)
                        off += len(raw)
                    require(snapshot(os.fstat(fd)) == snapshot(a) and snapshot(path.lstat()) == snapshot(a), 'report file read drift')
                    entries.append({'path': str(path.relative_to(self.container)), 'kind': 'file', 'snap': snapshot(a), 'sha256': digest.hexdigest()})
                finally:
                    os.close(fd)
        walk(self.child, 0)
        self.guard()
        require(len(entries) <= MAX_ENTRIES, 'report inventory cap')
        raw = json.dumps(entries, separators=(',', ':'), allow_nan=False).encode()
        return {'present': True, 'childDevIno': list(entries[0]['snap'][:2]), 'files': count,
                'bytes': total, 'entries': entries, 'digest': hashlib.sha256(raw).hexdigest()}

    def observation(self, phase, edge):
        inv = self.inventory()
        row = {'schema': 1, 'role': 'html-report-stage', 'identity': self.identity,
               'phase': phase, 'edge': edge, 'at': self.last_clock, 'ceiling': self.ceiling,
               'childPresent': inv['present'], 'childDevIno': inv.get('childDevIno'),
               'files': inv['files'], 'bytes': inv['bytes'], 'inventorySHA256': inv['digest'],
               'nativeClosure': 'UNKNOWN', 'childMayBeRecreated': True}
        self.check()
        require(len(self.events) < 8, 'report stage event count')
        raw = encoded(row)
        self.events.append(row)
        self.emit(raw)
        return inv

    def cleanup(self):
        inv = self.inventory()
        # Re-read the exact tree before deletion; foreign additions must not be removed.
        require(self.inventory() == inv, 'report pre-cleanup drift')
        directory_pins = {r['path']: tuple(r['snap'][:2]) for r in inv['entries'] if r['kind'] == 'dir'}
        for row in reversed(inv['entries']):
            self.guard()
            parts = Path(row['path']).parts
            require(parts and parts[0] == 'report' and all(x not in ('.', '..') for x in parts), 'report cleanup path')
            held = []
            parent_fd = self.container_fd
            try:
                for index, part in enumerate(parts[:-1]):
                    fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=parent_fd)
                    held.append(fd)
                    require(devino(os.fstat(fd)) == directory_pins['/'.join(parts[:index+1])], 'report cleanup ancestor drift')
                    parent_fd = fd
                before = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
                expected = tuple(row['snap'])
                if row['kind'] == 'file':
                    require(snapshot(before) == expected, 'report cleanup file drift')
                    os.unlink(parts[-1], dir_fd=parent_fd)
                else:
                    require(stat.S_ISDIR(before.st_mode) and devino(before) == tuple(expected[:2]), 'report cleanup directory drift')
                    os.rmdir(parts[-1], dir_fd=parent_fd)
            finally:
                for fd in reversed(held):
                    os.close(fd)
        self.guard()
        require(not os.listdir(self.container_fd), 'report cleanup foreign residue')
        # Stable container is retained with its pinned descriptor/metadata as handoff evidence.
        return {'removedFiles': inv['files'], 'removedBytes': inv['bytes'], 'reportChildRemoved': True,
                'containerRetained': True, 'nativeClosure': 'UNKNOWN'}

    def close(self):
        if self.closed:
            return
        self.closed = True
        first = None
        for fd in reversed(self.fds):
            try:
                os.close(fd)
            except BaseException as error:
                if first is None:
                    first = error
                else:
                    self.secondary.append(safe_error(error))
        self.fds.clear()
        if first is not None:
            raise first


class ReportHook:
    """Wrap only original actions. The owner supplies its already computed ceiling."""
    def __init__(self, artifact_root, temp_parent, identity, env, clock=time.monotonic, emit=None):
        self.args = (artifact_root, temp_parent, identity, env)
        self.clock, self.emit = clock, emit
        self.report = None
        self.secondary = []

    def note(self, error):
        if len(self.secondary) < 8:
            self.secondary.append(safe_error(error))
        else:
            self.secondaryOverflow = getattr(self, 'secondaryOverflow', 0)+1

    def __call__(self, name, owner, ceiling, action):
        require(callable(action), 'report original callable')
        if name not in ('PREPARE', 'DISCOVERY', 'PRODUCER', 'FINISH'):
            return action
        def wrapped():
            if name == 'PREPARE':
                result = action()
                self.report = ReportOwner(*self.args, ceiling, self.clock, self.emit)
                self.report.projected = True
                self.report.observation(name, 'after')
                return result
            if self.report is None and name == 'FINISH':
                return action()
            require(self.report is not None, 'report PREPARE missing')
            report = self.report
            if name in ('DISCOVERY', 'PRODUCER'):
                report.check(ceiling)
                report.observation(name, 'before')
                primary = None
                try:
                    result = action()
                except BaseException as error:
                    primary = error
                try:
                    report.observation(name, 'after')
                except BaseException as error:
                    if primary is None:
                        raise
                    self.note(error)
                if primary is not None:
                    raise primary
                return result
            primary = None
            try:
                # The original audit action runs even if report handling later refuses.
                result = action()
                report.check(ceiling)
                require(type(result) is dict and result.get('finalSourceEligible') is True,
                        'report cleanup requires original strict audit success')
                report.observation(name, 'beforeCleanup')
                report.cleanup()
                report.observation(name, 'afterCleanup')
            except BaseException as error:
                primary = error
            try:
                report.close()
            except BaseException as error:
                if primary is None:
                    primary = error
                else:
                    self.note(error)
            if self.secondary:
                try:
                    raw = encoded({'schema': 1, 'role': 'html-report-secondary', 'identity': report.identity,
                                   'secondary': self.secondary, 'overflow': getattr(self, 'secondaryOverflow', 0),
                                   'nativeClosure': 'UNKNOWN'})
                    require(len(report.events) < 8, 'report stage event count')
                    report.events.append({'role': 'html-report-secondary'})
                    report.emit(raw)
                except BaseException as error:
                    if primary is None:
                        primary = error
                    else:
                        self.note(error)
            if primary is not None:
                raise primary
            return result
        return wrapped

    def close(self):
        if self.report is not None:
            self.report.close()
