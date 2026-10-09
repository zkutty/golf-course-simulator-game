#!/usr/bin/env python3
"""Bound one explicitly scoped local diagnostic; report observed ownership only."""
import argparse, hashlib, json, os, pathlib, selectors, signal, subprocess, time

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--seconds', type=float, default=600)
ap.add_argument('--artifact-cap', type=int, default=1073741824)
ap.add_argument('--rss-cap', type=int)
ap.add_argument('command', nargs=argparse.REMAINDER)
a = ap.parse_args()
command = a.command[1:] if a.command[:1] == ['--'] else a.command
if not command or not 1 <= a.seconds <= 600:
    raise SystemExit('Invalid bounded diagnostic command')
out = pathlib.Path(a.out)
out.mkdir(mode=0o700, parents=True, exist_ok=False)
start = time.monotonic()
receipt = {'command': command, 'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'workerSeconds': a.seconds, 'parentSeconds': 180, 'stdioCap': 262144,
           'artifactCap': a.artifact_cap, 'observedRssCap': a.rss_cap, 'certificationEligible': False,
           'qualification': 'Observed local diagnostic process ownership; no universal native guarantee'}

def observe_table(pids=None):
    selected = list(pids if pids is not None else owned)
    if not selected:
        return {}
    if len(selected) > 256:
        raise RuntimeError('Process observation bound exceeded')
    r = subprocess.run(['/bin/ps', '-p', ','.join(map(str, selected)), '-o', 'pid=,ppid=,pgid=,stat=,lstart='],
                       capture_output=True, text=True, timeout=2)
    if (r.returncode not in (0, 1) or len(r.stdout.encode()) > 65536
            or (r.returncode == 1 and (r.stdout.strip() or r.stderr.strip()))):
        raise RuntimeError('Cannot observe owned process tree')
    rows = {}
    for line in r.stdout.splitlines():
        fields = line.split(None, 4)
        if len(fields) != 5:
            raise RuntimeError('Malformed owned process observation')
        pid = int(fields[0])
        if pid not in selected or pid in rows:
            raise RuntimeError('Unexpected owned process observation')
        rows[pid] = (int(fields[1]), int(fields[2]), fields[4], fields[3])
    return rows


def table(pids=None):
    try:
        return observe_table(pids)
    except BaseException as error:
        # Lost observation authority cannot be repaired by a later empty table.
        receipt['ownershipObservationFailed'] = True
        receipt['closureObservationError'] = str(error)[:512]
        raise


def matching_owned(rows):
    return {pid: identity for pid, identity in owned.items()
            if pid in rows and rows[pid][2] == identity}


def signal_owned(pid, identity, sig):
    # A previous inventory is never authority to signal a current PID.
    current = table([pid])
    if pid not in current or current[pid][2] != identity or current[pid][3].startswith('Z'):
        return False
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        return False
    return True

owned = {}
p = None
cause = None
total = 0
peak_observed_rss = 0
sel = selectors.DefaultSelector()
logs = {}
receipt['ownershipObservationFailed'] = False
try:
    p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    receipt['pid'] = p.pid
    rows = table([p.pid])
    if p.pid in rows:
        owned[p.pid] = rows[p.pid][2]
    else:
        raise RuntimeError('Initial child identity unavailable')
    for name, pipe in [('stdout', p.stdout), ('stderr', p.stderr)]:
        os.set_blocking(pipe.fileno(), False)
        sel.register(pipe, selectors.EVENT_READ, name)
        logs[name] = open(out / (name + '.log'), 'xb', buffering=0)
    last_observe = None
    while True:
        # poll() also reaps the direct child even when descendants retain its pipes.
        root_exit = p.poll()
        if not sel.get_map() and root_exit is not None:
            break
        elapsed = time.monotonic() - start
        if elapsed > a.seconds:
            raise RuntimeError('Worker deadline exceeded')
        if last_observe is None or elapsed - last_observe >= .5:
            rows = table()
            pending = list(rows)
            while pending:
                parent = pending.pop()
                if rows[parent][2] != owned[parent]:
                    continue
                try:
                    children = subprocess.run(['/usr/bin/pgrep', '-P', str(parent)], capture_output=True, text=True, timeout=2)
                    if children.returncode not in (0, 1) or len(children.stdout) > 4096:
                        raise RuntimeError('Owned child query refused')
                    child_pids = [int(x) for x in children.stdout.split()]
                except BaseException as error:
                    receipt['ownershipObservationFailed'] = True
                    receipt['closureObservationError'] = str(error)[:512]
                    raise
                if len(child_pids) > 256 - len(owned):
                    raise RuntimeError('Owned process inventory admission exceeded 256 identities')
                for pid, row in table(child_pids).items():
                    if pid not in owned and row[0] == parent:
                        if len(owned) >= 256:
                            raise RuntimeError('Owned process inventory full')
                        owned[pid] = row[2]
                        rows[pid] = row
                        pending.append(pid)
            artifact_bytes = 0
            if a.rss_cap and rows:
                rss = subprocess.run(['/bin/ps', '-p', ','.join(map(str, rows)), '-o', 'rss='], capture_output=True, text=True, timeout=2)
                if rss.returncode not in (0, 1) or len(rss.stdout) > 4096:
                    raise RuntimeError('Owned RSS observation unavailable')
                observed_rss = sum(int(x) * 1024 for x in rss.stdout.split())
                peak_observed_rss = max(peak_observed_rss, observed_rss)
                if observed_rss > a.rss_cap:
                    raise RuntimeError('Observed owned RSS cap exceeded')
            for file in out.rglob('*'):
                if file.is_symlink():
                    raise RuntimeError('Artifact symlink refused')
                if file.is_file():
                    artifact_bytes += file.stat().st_size
            if artifact_bytes > a.artifact_cap:
                raise RuntimeError('Artifact disk cap exceeded')
            last_observe = elapsed
        if root_exit is not None and any(pid != p.pid for pid in matching_owned(rows)):
            # Observed descendants are cleanup work once the root has exited.
            break
        for key, _ in sel.select(.1):
            data = os.read(key.fileobj.fileno(), 16384)
            if not data:
                sel.unregister(key.fileobj)
                key.fileobj.close()
                continue
            admitted = min(len(data), 262144 - total)
            if admitted:
                logs[key.data].write(data[:admitted])
                total += admitted
            if admitted != len(data):
                raise RuntimeError('Combined stdout/stderr cap exceeded')
    receipt['exitCode'] = p.wait(timeout=1)
except BaseException as error:
    cause = str(error)[:512]
finally:
    # Closure stays unknown until every owned identity is reconciled after reap.
    cleanup = []
    receipt['finalReconciliationCompleted'] = False
    receipt['ownedStillObserved'] = None
    receipt['ownedLiveStillObserved'] = None
    receipt['ownedZombieStillObserved'] = None
    try:
        rows = table()
        live = matching_owned(rows)
        receipt['remainingAtCommandExit'] = list(live)
        for sig, pause in [(signal.SIGTERM, 3), (signal.SIGKILL, 2)]:
            for pid, identity in live.items():
                if signal_owned(pid, identity, sig):
                    cleanup.append({'pid': pid, 'signal': sig.name})
            deadline = min(start + 178, time.monotonic() + pause)
            while time.monotonic() < deadline:
                if p is not None:
                    p.poll()
                rows = table()
                live = matching_owned(rows)
                if not live:
                    break
                time.sleep(.1)
    except BaseException as error:
        receipt['ownershipObservationFailed'] = True
        receipt['closureObservationError'] = str(error)[:512]
        if cause is None:
            cause = 'Ownership closure unverified'
    if p is not None:
        try:
            receipt['exitCode'] = p.wait(timeout=max(.1, min(1, start + 179 - time.monotonic())))
            receipt['childReaped'] = True
        except BaseException:
            receipt['childReaped'] = False
            cause = cause or 'Child reap unverified'
    try:
        # Fresh all-owned inventory after wait/reap, including identities absent
        # from any intermediate snapshot; zombies remain observed, not alive.
        rows = table()
        remaining = matching_owned(rows)
        receipt['ownedStillObserved'] = list(remaining)
        receipt['ownedLiveStillObserved'] = [pid for pid in remaining if not rows[pid][3].startswith('Z')]
        receipt['ownedZombieStillObserved'] = [pid for pid in remaining if rows[pid][3].startswith('Z')]
        receipt['finalReconciliationCompleted'] = True
        receipt['closureQualification'] = 'Fresh post-reap PID+lstart reconciliation of all observed owned identities; any matching zombie prevents closure'
    except BaseException as error:
        receipt['ownershipObservationFailed'] = True
        receipt['closureObservationError'] = str(error)[:512]
        cause = cause or 'Ownership closure unverified'
    for key in list(sel.get_map().values()):
        sel.unregister(key.fileobj)
        key.fileobj.close()
    sel.close()
    for f in logs.values():
        os.fsync(f.fileno())
        f.close()
    receipt.update({'cause': cause, 'stdioBytes': total, 'elapsedSeconds': time.monotonic() - start,
                    'peakObservedOwnedRss': peak_observed_rss,
                    'observedOwnedIdentities': [{'pid': pid, 'start': identity} for pid, identity in owned.items()],
                    'cleanupSignals': cleanup})
    inventory = []
    try:
        files = list(out.rglob('*'))
        if len(files) > 2048 or any(f.is_symlink() for f in files):
            raise RuntimeError('Final artifact inventory admission refused')
        final_bytes = sum(f.stat().st_size for f in files if f.is_file())
        receipt['artifactBytes'] = final_bytes
        if final_bytes > a.artifact_cap:
            raise RuntimeError('Final artifact disk cap exceeded')
        for file in sorted(files):
            if time.monotonic() - start >= 179:
                raise RuntimeError('Parent finalization deadline exceeded')
            if file.is_file():
                digest = hashlib.sha256()
                with open(file, 'rb') as f:
                    while True:
                        if time.monotonic() - start >= 179:
                            raise RuntimeError('Parent hash deadline exceeded')
                        chunk = f.read(32768)
                        if not chunk:
                            break
                        digest.update(chunk)
                inventory.append({'path': str(file.relative_to(out)), 'bytes': file.stat().st_size, 'sha256': digest.hexdigest()})
    except BaseException as error:
        cause = cause or str(error)[:512]
        receipt['cause'] = cause
    receipt['artifacts'] = inventory
    receipt['closureVerified'] = (receipt.get('childReaped') is True
                                  and receipt.get('finalReconciliationCompleted') is True
                                  and receipt.get('ownedStillObserved') == []
                                  and receipt.get('ownershipObservationFailed') is False
                                  and 'closureObservationError' not in receipt)
    receipt['elapsedSeconds'] = time.monotonic() - start
    if receipt['elapsedSeconds'] >= 179:
        cause = cause or 'Parent final receipt deadline exceeded'
        receipt['cause'] = cause
    receipt['passed'] = cause is None and receipt.get('exitCode') == 0 and receipt['closureVerified']
    data = (json.dumps(receipt, indent=2) + '\n').encode()
    if len(data) > 1048576:
        raise SystemExit('Final receipt exceeded 1MiB')
    with open(out / 'owned-command-receipt.json', 'xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    if time.monotonic() - start >= 180:
        # A late durable write is not an acknowledged successful invocation.
        receipt['passed'] = False
        receipt['cause'] = receipt['cause'] or 'Durable final receipt completed after parent deadline'
        with open(out / 'late-finalization-hold.json', 'xb') as f:
            f.write((json.dumps({'passed': False, 'cause': receipt['cause']}) + '\n').encode())
    print(json.dumps({k: receipt[k] for k in ['passed', 'exitCode', 'cause', 'elapsedSeconds', 'closureVerified']}))
raise SystemExit(0 if receipt['passed'] else 1)
