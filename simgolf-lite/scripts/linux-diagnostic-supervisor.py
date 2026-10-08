#!/usr/bin/env python3
"""Bound one explicitly scoped local diagnostic; report observed ownership only."""
import argparse, hashlib, json, os, pathlib, selectors, signal, subprocess, time

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--seconds', type=float, default=600)
ap.add_argument('--parent-seconds', type=float, default=660)
ap.add_argument('--artifact-cap', type=int, default=1073741824)
ap.add_argument('--rss-cap', type=int)
ap.add_argument('command', nargs=argparse.REMAINDER)
a = ap.parse_args()
command = a.command[1:] if a.command[:1] == ['--'] else a.command
if not command or not 1 <= a.seconds <= 1850 or not a.seconds + 1 <= a.parent_seconds <= 1910:
    raise SystemExit('Invalid bounded diagnostic command')
out = pathlib.Path(a.out)
out.mkdir(mode=0o700, parents=True, exist_ok=False)
start = time.monotonic()
receipt = {'command': command, 'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'workerSeconds': a.seconds, 'parentSeconds': a.parent_seconds, 'stdioCap': 262144,
           'artifactCap': a.artifact_cap, 'observedRssCap': a.rss_cap, 'certificationEligible': False,
           'qualification': 'Observed local diagnostic process ownership; no universal native guarantee'}

def table(pids=None):
    selected = list(pids if pids is not None else owned)
    if not selected:
        return {}
    if len(selected) > 256:
        raise RuntimeError('Process observation bound exceeded')
    r = subprocess.run(['/bin/ps', '-p', ','.join(map(str, selected)), '-o', 'pid=,ppid=,pgid=,stat=,lstart='],
                       capture_output=True, text=True, timeout=2)
    if r.returncode not in (0, 1) or len(r.stdout.encode()) > 65536:
        raise RuntimeError('Cannot observe owned process tree')
    rows = {}
    for line in r.stdout.splitlines():
        fields = line.split(None, 4)
        if len(fields) == 5:
            rows[int(fields[0])] = (int(fields[1]), int(fields[2]), fields[4], fields[3])
    return rows

owned = {}
p = None
cause = None
total = 0
peak_observed_rss = 0
sel = selectors.DefaultSelector()
logs = {}
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
    last_observe = 0
    while True:
        root_exited = p.poll() is not None
        elapsed = time.monotonic() - start
        if elapsed > a.seconds:
            raise RuntimeError('Worker deadline exceeded')
        if elapsed - last_observe >= .5:
            rows = table()
            pending = list(rows)
            while pending:
                parent = pending.pop()
                if rows[parent][2] != owned[parent]:
                    continue
                children = subprocess.run(['/usr/bin/pgrep', '-P', str(parent)], capture_output=True, text=True, timeout=2)
                if children.returncode not in (0, 1) or len(children.stdout) > 4096:
                    raise RuntimeError('Owned child query refused')
                child_pids = [int(x) for x in children.stdout.split()]
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
        if root_exited:
            receipt['postRootExitOutputQualification'] = 'One bounded ready read per stream before owned cleanup; stdout may be partial, not an EOF guarantee'
            break
    receipt['exitCode'] = p.wait(timeout=1)
except BaseException as error:
    cause = str(error)[:512]
finally:
    # Signal only PIDs whose observed start identity still matches this invocation.
    cleanup = []
    try:
        rows = table()
        live = {pid: identity for pid, identity in owned.items() if pid in rows and rows[pid][2] == identity}
        receipt['remainingAtCommandExit'] = list(live)
        for sig, pause in [(signal.SIGTERM, 3), (signal.SIGKILL, 2)]:
            for pid, identity in live.items():
                try:
                    os.kill(pid, sig)
                    cleanup.append({'pid': pid, 'signal': sig.name})
                except ProcessLookupError:
                    pass
            deadline = min(start + a.parent_seconds - 2, time.monotonic() + pause)
            while time.monotonic() < deadline:
                if p is not None:
                    p.poll()  # Reap the owned root when it has exited before observing remaining identities.
                rows = table()
                live = {pid: identity for pid, identity in live.items() if pid in rows and rows[pid][2] == identity}
                if not live:
                    break
                time.sleep(.1)
        receipt['ownedStillObserved'] = list(live)
    except BaseException as error:
        receipt['closureObservationError'] = str(error)[:512]
        if cause is None:
            cause = 'Ownership closure unverified'
    if p is not None:
        try:
            receipt['exitCode'] = p.wait(timeout=max(.1, min(1, start + a.parent_seconds - 1 - time.monotonic())))
            receipt['childReaped'] = True
        except BaseException:
            receipt['childReaped'] = False
            cause = cause or 'Child reap unverified'
    try:
        rows = table()
        matching = {pid: row for pid, row in rows.items() if pid in owned and row[2] == owned[pid]}
        receipt['ownedZombiesStillObserved'] = [pid for pid, row in matching.items() if row[3].startswith('Z')]
        receipt['ownedStillObserved'] = [pid for pid, row in matching.items() if not row[3].startswith('Z')]
        receipt['closureQualification'] = 'Owned root reaped; remaining matching non-zombie identities observed. Zombies are recorded separately and cannot execute; no universal process absence guarantee.'
    except BaseException as error:
        receipt['closureObservationError'] = str(error)[:512]
        cause = cause or 'Post-reap ownership closure unverified'
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
            if time.monotonic() - start >= a.parent_seconds - 1:
                raise RuntimeError('Parent finalization deadline exceeded')
            if file.is_file():
                digest = hashlib.sha256()
                with open(file, 'rb') as f:
                    while True:
                        if time.monotonic() - start >= a.parent_seconds - 1:
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
    receipt['closureVerified'] = receipt.get('childReaped') and not receipt.get('ownedStillObserved') and not receipt.get('closureObservationError')
    receipt['elapsedSeconds'] = time.monotonic() - start
    if receipt['elapsedSeconds'] >= a.parent_seconds - 1:
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
    if time.monotonic() - start >= a.parent_seconds:
        # A late durable write is not an acknowledged successful invocation.
        receipt['passed'] = False
        receipt['cause'] = receipt['cause'] or 'Durable final receipt completed after parent deadline'
        with open(out / 'late-finalization-hold.json', 'xb') as f:
            f.write((json.dumps({'passed': False, 'cause': receipt['cause']}) + '\n').encode())
    print(json.dumps({k: receipt[k] for k in ['passed', 'exitCode', 'cause', 'elapsedSeconds', 'closureVerified']}))
raise SystemExit(0 if receipt['passed'] else 1)
