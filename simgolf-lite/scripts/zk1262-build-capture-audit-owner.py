"""Explicit same-parent integration. Import is inert; ROOT owns runtime admission."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import time

PHASES = ('BUILD','NORMALIZE','PREPARE','DISCOVERY','READY','PRODUCER','CLEANUP','FINISH')
JOURNAL = 'held-owner-phases.jsonl'
CAP = 32768
TERM = 2820
KILL = 2880
BUILD = ['npm','run','build']
DISCOVERY = ['npx','playwright','test','e2e/zk1262-capture-phase-diagnostic.e2e.ts',
             '--list','--reporter=line','--workers=1','--retries=0']
NORMALIZER_PIN = {'bytes':17794,'sha256':'75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'}
NORMALIZER_TEST_PIN = {'bytes':13545,'sha256':'f5f1f98606855971a4e17eb5f3897134a6f6dee36c1a11214feaa6a686f50e6d'}
EXTRA_PATHS = ('simgolf-lite/scripts/zk1262-build-capture-audit-owner.py',
               'simgolf-lite/scripts/zk1262-build-capture-audit-owner.test.py',
               'simgolf-lite/scripts/zk1262-build-audit-normalization.py',
               'simgolf-lite/scripts/zk1262-build-audit-normalization.test.py')
AUDIT_NAMES = ('baseline-audit.json','before.json','generated-audit.json','generated.json',
               'normalized.json','normalization-failure.json','before-failure.json',
               'final.json','final-failure.json')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def identity(info):
    return (info.st_dev, info.st_ino)


def encoded(value):
    data = (json.dumps(value,separators=(',',':'),allow_nan=False)+'\n').encode()
    require(len(data)<=CAP,'journal row cap')
    return data


def error_value(error):
    value = {'type':'Error','message':'UNKNOWN','cause':None,'formatErrors':[]}
    notes = value['formatErrors']
    try:value['type'] = type(error).__name__[:128]
    except BaseException:notes.append('type')
    try:value['message'] = str(error)[:1024]
    except BaseException:notes.append('message')
    try:
        attrs = BaseException.__dict__['__dict__'].__get__(error)
        cause = attrs.get('cause')
        if 'cause' not in attrs:
            for cls in type.__getattribute__(type(error),'__mro__'):
                fields = type.__getattribute__(cls,'__dict__')
                if 'cause' in fields:
                    cause = fields['cause'];break
        if type(cause) is str:cause = cause[:1024]
        elif type(cause) is int:require(cause.bit_length()<=128,'integer cap')
        elif type(cause) is float:require(math.isfinite(cause),'finite')
        else:require(type(cause) in (bool,type(None)),'primitive')
        value['cause'] = cause
    except BaseException:notes.append('cause')
    return value


class Failure:
    def __init__(self):
        self.present = False
        self.original = None
        self.first = None
        self.secondary = []

    def record(self, phase, error):
        first=not self.present
        if first:
            self.present,self.original = True,error
        row = {'phase':phase,'error':error_value(error)}
        if first:self.first = row
        else:self.secondary.append(row)


class Deadline:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.start = clock()
        self.end = self.start + TERM

    def remaining(self, ceiling=None):
        value = self.end-self.clock()
        if ceiling is not None:
            value = min(value,ceiling-self.clock())
        require(value>0,'absolute parent/component deadline')
        return value

    def cap(self, seconds, ceiling=None):
        return min(seconds,self.remaining(ceiling))


class Journal:
    def __init__(self, h, root, header):
        self.h,self.root = h,Path(root)
        self.directory = os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        self.parent_id = identity(os.fstat(self.directory))
        self.fd = None
        self.size = 0
        self.seq = 0
        self.bytes = b''
        try:
            self.fd = os.open(JOURNAL,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                              0o600,dir_fd=self.directory)
            info = os.fstat(self.fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'journal regular single link')
            self.file_id = identity(info)
            self.append({'kind':'HEADER',**header,'journalIdentity':list(self.file_id),
                         'rootIdentity':list(self.parent_id)})
        except BaseException:
            self.close()
            raise

    def physical(self):
        require(identity(self.root.lstat())==self.parent_id and
                identity(os.fstat(self.directory))==self.parent_id,'journal parent drift')
        located = os.stat(JOURNAL,dir_fd=self.directory,follow_symlinks=False)
        opened = os.fstat(self.fd)
        require(identity(located)==self.file_id==identity(opened) and
                stat.S_ISREG(located.st_mode) and located.st_nlink==1,'journal path/inode drift')
        require(opened.st_size==self.size and os.pread(self.fd,CAP+1,0)==self.bytes,
                'journal concurrent byte drift')

    def append(self, row):
        self.physical()
        data = encoded({'sequence':self.seq,**row})
        require(self.size+len(data)<=CAP,'journal total cap')
        offset = 0
        while offset<len(data):
            n = os.pwrite(self.fd,data[offset:],self.size+offset)
            require(n>0,'journal write progress')
            offset += n
        self.size += len(data)
        self.bytes += data
        os.fsync(self.fd)
        os.fsync(self.directory)
        self.physical()
        self.seq += 1

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        if getattr(self,'directory',None) is not None:
            os.close(self.directory)
            self.directory = None


def producer_argv(h, root):
    return ['node','scripts/zk1262-run-capture-phase-diagnostic.mjs',
            '--expected-commit',h['CANDIDATE'],'--output',str(root/'renderer-resource-growth.json')]


def commands(h, root):
    return {'BUILD':BUILD,'NORMALIZE':['AuditOwner.normalize',True],
            'PREPARE':['four-exact-owned-projections','default-sdk-binding'],
            'DISCOVERY':DISCOVERY,'READY':['capture-phase-driver.ready'],
            'PRODUCER':producer_argv(h,root),'CLEANUP':['four-owned-dev-ino-only'],
            'FINISH':['AuditOwner.finish']}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name,path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def source_bindings(h, driver, source):
    h['driver_guard'](driver,source)
    result = {}
    for relative in EXTRA_PATHS:
        data,pin = h['file_bytes'](driver/relative,CAP)
        require(data==h['git'](driver,'show',source+':'+relative),'held-owner committed source drift')
        result[relative] = {k:pin[k] for k in ('bytes','sha256')}
    require(result[EXTRA_PATHS[2]]==NORMALIZER_PIN,'immutable normalizer module')
    require(result[EXTRA_PATHS[3]]==NORMALIZER_TEST_PIN,'immutable normalizer controls')
    return result


class ChildFailure(RuntimeError):
    def __init__(self, receipt):
        self.receipt = receipt
        self.cause = receipt['exitCode']
        super().__init__('child failed or timed out: '+str(self.cause))


def child(argv, cwd, env, deadline, seconds, grace, outputs, output_cap,
          ceiling=None, clock=time.monotonic):
    started = clock()
    term_at = started+deadline.cap(seconds,ceiling)
    kill_at = min(term_at+grace,deadline.end,ceiling if ceiling is not None else deadline.end)
    files = []
    proc = None
    selector = selectors.DefaultSelector()
    counts = [0]*len(outputs)
    digests = [hashlib.sha256() for _ in outputs]
    timed_out = False
    term_sent = False
    kill_sent = False
    waited = False
    code = None
    try:
        for path in outputs:
            fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            files.append(fd)
        proc = subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        selector.register(proc.stdout,selectors.EVENT_READ,0)
        selector.register(proc.stderr,selectors.EVENT_READ,0 if len(outputs)==1 else 1)
        while selector.get_map() or proc.poll() is None:
            now = clock()
            if now>=term_at and not term_sent:
                timed_out = True
                term_sent = True
                try:os.killpg(proc.pid,signal.SIGTERM)
                except ProcessLookupError:pass
            if now>=kill_at and not kill_sent:
                kill_sent = True
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                break
            wait = min(.1,max(0,kill_at-now),deadline.remaining())
            for key,_ in selector.select(wait):
                index = key.data
                chunk = os.read(key.fileobj.fileno(),min(4096,output_cap-counts[index]+1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                counts[index] += len(chunk)
                require(counts[index]<=output_cap,'child output cap')
                digests[index].update(chunk)
                offset = 0
                while offset<len(chunk):
                    n = os.write(files[index],chunk[offset:])
                    require(n>0,'child log write progress')
                    offset += n
        code = proc.wait(timeout=deadline.cap(2,ceiling))
        waited = True
    finally:
        selector.close()
        if proc is not None:
            if proc.poll() is None:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                try:proc.wait(timeout=deadline.cap(2,ceiling))
                except BaseException:pass
            proc.stdout.close()
            proc.stderr.close()
        for fd in files:
            try:os.fsync(fd)
            finally:os.close(fd)
    result = {'kind':'ACTUAL_CHILD_WAIT','argv':list(argv),'cwd':str(cwd),
              'exitCode':code,'waited':waited,'timeout':timed_out,
              'durationSeconds':clock()-started,'termAllocationSeconds':seconds,
              'killGraceSeconds':grace,'termDeadline':term_at,'killDeadline':kill_at,
              'outputs':[{'path':str(p),'bytes':counts[i],'sha256':digests[i].hexdigest()}
                         for i,p in enumerate(outputs)],'processClosure':'UNKNOWN'}
    if not waited or timed_out or code!=0:
        raise ChildFailure(result)
    return result


def successful_build(receipt, argv, cwd):
    require(type(receipt) is dict and receipt.get('kind')=='ACTUAL_CHILD_WAIT' and
            receipt.get('argv')==argv and receipt.get('cwd')==str(cwd) and
            receipt.get('waited') is True and receipt.get('timeout') is False and
            type(receipt.get('exitCode')) is int and receipt['exitCode']==0,
            'actual successful original build receipt required')


class ProjectionOwner:
    def __init__(self, h, driver, target, deadline):
        self.h,self.driver,self.target,self.deadline = h,driver,target,deadline
        self.owned = {}
        self.parents = {}

    def project(self):
        h = self.h
        for relative,pin in h['TOOLS'].items():
            self.deadline.remaining()
            data,source = h['file_bytes'](self.driver/relative,65536)
            require({k:source[k] for k in ('bytes','sha256')}==pin,'exact projection pin')
            row = next(r for r in h['MAPS'] if r['target']==relative)
            h['invert_projection'](data,row)
            path = self.target/relative
            path.parent.mkdir(parents=True,exist_ok=True)
            h['canonical'](path.parent)
            directory = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            parent_id = identity(os.fstat(directory))
            self.parents[relative] = (directory,parent_id,path.parent)
            fd = os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                         0o600,dir_fd=directory)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'projection owned regular')
                self.owned[relative] = {'dev':info.st_dev,'ino':info.st_ino,**pin}
                offset = 0
                while offset<len(data):
                    self.deadline.remaining()
                    n = os.write(fd,data[offset:])
                    require(n>0,'projection write progress')
                    offset += n
                os.fsync(fd)
                require(identity(os.fstat(fd))==identity(info),'projection fd drift')
            finally:os.close(fd)
            require(identity(path.parent.lstat())==parent_id,'projection parent drift')
            _,actual = h['file_bytes'](path,65536)
            require(all(actual[k]==self.owned[relative][k] for k in ('dev','ino','bytes','sha256')),
                    'projection final identity/pin')
        return self.owned

    def cleanup(self):
        errors = []
        removed = []
        for relative,owned in self.owned.items():
            try:
                self.deadline.remaining()
                fd,parent_id,path = self.parents[relative]
                require(identity(path.lstat())==parent_id==identity(os.fstat(fd)),
                        'cleanup parent drift; preserve foreign')
                located = os.stat(Path(relative).name,dir_fd=fd,follow_symlinks=False)
                require(stat.S_ISREG(located.st_mode) and located.st_nlink==1 and
                        identity(located)==(owned['dev'],owned['ino']),
                        'cleanup foreign inode/type/link; preserve')
                os.unlink(Path(relative).name,dir_fd=fd)
                os.fsync(fd)
                removed.append(relative)
            except BaseException as error:
                errors.append({'path':relative,'error':error_value(error)})
        if errors:
            error = RuntimeError('owned projection cleanup failed')
            error.cause = errors
            raise error
        return {'removed':removed,'owned':self.owned,'onlyFourDeclaredPaths':True}

    def close(self):
        for fd,_,_ in self.parents.values():
            os.close(fd)
        self.parents.clear()


def evidence_pins(h, path):
    if not path.exists():
        return None
    h['canonical'](path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode),'normalizer evidence directory')
    names = list(path.iterdir())
    require(len(names)<=len(AUDIT_NAMES),'normalizer evidence file count')
    rows = []
    total = 0
    for item in sorted(names):
        require(item.name in AUDIT_NAMES,'foreign normalizer evidence role')
        cap = 65536 if item.name.endswith('audit.json') else CAP
        data,pin = h['file_bytes'](item,cap)
        h['strict_json'](data,cap)
        total += len(data)
        require(total<=262144,'normalizer evidence aggregate cap')
        rows.append({'role':item.name,'path':str(item),**pin})
    require(identity(path.lstat())==identity(info),'normalizer evidence parent drift')
    return {'path':str(path),'dev':info.st_dev,'ino':info.st_ino,'files':rows}


def run(h, driver, target, root, env, *, owner_factory=None, runner=child,
        clock=time.monotonic, phase_hook=None, bindings=None):
    deadline = Deadline(clock)
    roles = h['roles'](env)
    state = h['read_state'](root)
    require(state.get('roles')==roles and state.get('firstFailurePresent') is False and
            state.get('sourceQualified') is True,'initial qualified role intent required')
    if bindings is None:
        bindings = source_bindings(h,driver,roles['driver_sha'])
    audit_path = Path(str(root)+'-audit-owner')
    argv = commands(h,root)
    journal = Journal(h,root,{'schemaVersion':1,'kindRole':'held-build-audit-owner-phases',
        'roles':roles,'bindings':bindings,'target':str(target),'root':str(root),
        'auditEvidence':str(audit_path),'phases':list(PHASES),'commands':argv,
        'started':deadline.start,'parentTermDeadline':deadline.end,
        'parentTERMSeconds':TERM,'parentKILLSeconds':KILL})
    failures = Failure()
    owner = None
    owner_closed = False
    projection = ProjectionOwner(h,driver,target,deadline)
    prep_end = None
    overhead_end = None
    current = 'BUILD'
    build_receipt = None
    original_run = subprocess.run
    old_alarm,old_term = signal.getsignal(signal.SIGALRM),signal.getsignal(signal.SIGTERM)
    active_end = deadline.end

    def interrupted(signum, frame):
        raise TimeoutError('absolute active/parent deadline or parent TERM')

    def bounded_run(*args,**kwargs):
        kwargs['timeout'] = deadline.cap(kwargs.get('timeout',10),active_end)
        return original_run(*args,**kwargs)

    def phase(name, action, allocation, ceiling=None):
        nonlocal current,active_end
        current = name
        entered = clock()
        active_end = min(deadline.end,entered+allocation,ceiling if ceiling is not None else deadline.end)
        deadline.remaining(active_end)
        journal.append({'kind':'ENTERED','phase':name,'at':entered,'argv':argv[name],
                        'entered':True,'completed':False,'exit':None,'causePresent':False,
                        'cause':None,'deadline':active_end,'allocation':allocation,'ceiling':ceiling})
        try:
            signal.setitimer(signal.ITIMER_REAL,deadline.remaining(active_end))
            if phase_hook is not None:
                phase_hook(name,owner)
            result = action()
            deadline.remaining(active_end)
            journal.append({'kind':'COMPLETED','phase':name,'at':clock(),'argv':argv[name],
                'entered':True,'completed':True,'exit':0,'causePresent':False,
                'cause':None,'result':result})
            return result
        except BaseException as error:
            failures.record(name,error)
            value = error_value(error)
            journal.append({'kind':'COMPLETED','phase':name,'at':clock(),'argv':argv[name],
                'entered':True,'completed':True,'exit':value['cause'] if type(value['cause']) is int else 1,
                'causePresent':True,'cause':value,
                'result':error.receipt if type(error) is ChildFailure else None})
            raise
        finally:
            signal.setitimer(signal.ITIMER_REAL,0)

    signal.signal(signal.SIGALRM,interrupted)
    signal.signal(signal.SIGTERM,interrupted)
    subprocess.run = bounded_run
    try:
        def build():
            nonlocal owner
            if owner_factory is None:
                m = load(driver/EXTRA_PATHS[2],'zk1262_registered_normalizer')
                m.GIT_SECONDS = deadline.cap(10,active_end)
                owner = m.AuditOwner(target,audit_path,m.registered_policy())
            else:
                owner = owner_factory(target,audit_path)
            candidate_env = {**env,'GITHUB_SHA':h['CANDIDATE'],
                'VITE_COMMIT_SHA':h['CANDIDATE'],'ZK682_EXPECTED_COMMIT':h['CANDIDATE']}
            return runner(BUILD,target/'simgolf-lite',candidate_env,deadline,600,0,
                [root/'build.stdout.log',root/'build.stderr.log'],CAP,ceiling=active_end,clock=clock)
        build_receipt = phase('BUILD',build,600)
        successful_build(build_receipt,BUILD,target/'simgolf-lite')
        overhead_end = min(deadline.end,clock()+30)
        def normalize():
            journal.physical()
            successful_build(build_receipt,BUILD,target/'simgolf-lite')
            result = owner.normalize(True)
            require(result.get('producerEligible') is True,'normalizer explicit eligibility')
            return result
        phase('NORMALIZE',normalize,30,overhead_end)
        overhead_left = max(0,overhead_end-clock())
        prep_end = min(deadline.end,clock()+120)
        def prepare():
            h['driver_guard'](driver,roles['driver_sha'])
            proof = h['source_guard'](target,h['CANDIDATE'],h['PINS'])
            h['wx'](root/'source-preproducer.json',proof)
            require(proof['ok'],'strict normalized preproducer source')
            for relative,pin in h['IMPORTS'].items():
                _,actual = h['file_bytes'](target/relative,65536)
                require({k:actual[k] for k in ('bytes','sha256')}==pin,'unchanged producer import')
            owned = projection.project()
            h['wx'](root/'projection-proof.json',{'schemaVersion':1,'fourFullInverse':True,'owned':owned})
            require(h['source_guard'](target,h['CANDIDATE'],h['PINS'],owned)['ok'],
                    'preproducer owned projection/source')
            h['wx'](root/'sdk-binding.json',h['sdk_binding'](target),65536)
            return {'owned':owned,'sdkBound':True}
        phase('PREPARE',prepare,120,prep_end)
        phase('DISCOVERY',lambda:runner(DISCOVERY,target/'simgolf-lite',env,deadline,60,5,
            [root/'discovery.log'],262144,ceiling=prep_end,clock=clock),120,prep_end)
        phase('READY',lambda:(h['ready'](driver,target,root) or {'ready':True}),120,prep_end)
        candidate_env = {**env,'GITHUB_SHA':h['CANDIDATE'],
            'VITE_COMMIT_SHA':h['CANDIDATE'],'ZK682_EXPECTED_COMMIT':h['CANDIDATE']}
        def produce():
            try:
                result = runner(argv['PRODUCER'],target/'simgolf-lite',candidate_env,deadline,
                    1920,60,[root/'producer.stdout.log',root/'producer.stderr.log'],1073741824,
                    ceiling=active_end,clock=clock)
            except ChildFailure as error:
                h['wx'](root/'producer-exit.json',{'exitCode':error.receipt['exitCode'],
                    'workerTERMSeconds':1920,'killGraceSeconds':60,'processClosure':'UNKNOWN'})
                raise
            h['wx'](root/'producer-exit.json',{'exitCode':result['exitCode'],
                'workerTERMSeconds':1920,'killGraceSeconds':60,'processClosure':'UNKNOWN'})
            return result
        phase('PRODUCER',produce,1980)
    except BaseException as error:
        if not failures.present or failures.original is not error:
            failures.record(current,error)
    finally:
        try:
            phase('CLEANUP',projection.cleanup,60)
        except BaseException as error:
            if not failures.present or failures.original is not error:
                if not failures.secondary or failures.secondary[-1]['phase']!='CLEANUP':
                    failures.record('CLEANUP',error)
        try:
            finish_budget = locals().get('overhead_left',30)
            require(owner is not None,'owner construction never completed')
            phase('FINISH',owner.finish,finish_budget)
        except BaseException as error:
            if not failures.present or failures.original is not error:
                if not failures.secondary or failures.secondary[-1]['phase']!='FINISH':
                    failures.record('FINISH',error)
        finally:
            signal.setitimer(signal.ITIMER_REAL,0)
            try:
                if owner is not None:
                    owner.close()
                    owner_closed = True
            except BaseException as error:
                failures.record('CLOSE',error)
            try:projection.close()
            except BaseException as error:failures.record('CLEANUP_CLOSE',error)
            subprocess.run = original_run
            signal.signal(signal.SIGALRM,old_alarm)
            signal.signal(signal.SIGTERM,old_term)
        try:
            journal.append({'kind':'TERMINAL','at':clock(),'firstFailurePresent':failures.present,
                'firstFailure':failures.first,'secondaryFailures':failures.secondary,
                'ownerClosed':owner_closed,'auditEvidencePins':evidence_pins(h,audit_path),
                'processClosure':'UNKNOWN'})
        except BaseException as error:
            failures.record('JOURNAL_TERMINAL',error)
        finally:journal.close()
    return not failures.present


def validate(h, driver, target, root, env):
    ok = require
    data,pin = h['file_bytes'](root/JOURNAL,CAP)
    ok(data.endswith(b'\n'),'tail')
    lines = data.splitlines()
    ok(1<=len(lines)<=18,'count')
    rows = [h['strict_json'](line,CAP) for line in lines]
    ok(all(type(r) is dict and type(r.get('sequence')) is int and r['sequence']==i for i,r in enumerate(rows)),'sequence')
    head = rows[0].get
    argv = commands(h,root)
    expected = {'kind':'HEADER','schemaVersion':1,'kindRole':'held-build-audit-owner-phases',
        'roles':h['roles'](env),'bindings':source_bindings(h,driver,env['CAPTURE_SOURCE_SHA']),
        'target':str(target),'root':str(root),'auditEvidence':str(root)+'-audit-owner',
        'journalIdentity':[pin['dev'],pin['ino']],'rootIdentity':list(identity(root.lstat())),
        'phases':list(PHASES),'commands':argv,'parentTERMSeconds':TERM,'parentKILLSeconds':KILL}
    ok(all(head(k)==v for k,v in expected.items()),'header')
    finite = lambda v:type(v) in (int,float) and math.isfinite(v)
    start = head('started')
    ok(finite(start) and head('parentTermDeadline')==start+TERM,'envelope')
    term,kill = start+TERM,start+KILL
    limits = dict(zip(PHASES,(600,30,120,120,120,1980,60,30)))
    states = {p:'SKIPPED' for p in PHASES}
    first = active = final = None
    until = entered = prep_end = None
    spent = 0
    seen = set()
    last = start
    for row in rows[1:]:
        get = row.get
        at = get('at')
        ok(finite(at) and last<=at<=kill,'clock/envelope')
        last = at
        if get('kind')=='TERMINAL':
            ok(row is rows[-1] and final is None,'terminal')
            ok(all(type(get(k)) is t for k,t in (('firstFailurePresent',bool),('ownerClosed',bool),('secondaryFailures',list))),'terminal presence')
            final = row
            continue
        phase = get('phase')
        ok(phase in PHASES and get('argv')==argv[phase] and get('entered') is True and type(get('causePresent')) is bool,'phase')
        if get('kind')=='ENTERED':
            ok(active is None and phase not in seen and all(get(k) is v for k,v in
               (('completed',False),('exit',None),('causePresent',False),('cause',None))),'duplicate enter')
            index = PHASES.index(phase)
            ok(not seen or index>max(PHASES.index(p) for p in seen),'phase order')
            end = get('deadline')
            budget,ceiling = get('allocation'),get('ceiling')
            ok(finite(budget) and 0<budget<=limits[phase] and
               (ceiling is None or finite(ceiling) and ceiling<=term),'phase limit')
            ok(finite(end) and at<end==min(term,at+budget,ceiling if ceiling is not None else term),'deadline')
            if phase=='PREPARE':prep_end = ceiling
            if phase in ('PREPARE','DISCOVERY','READY'):
                ok(prep_end is not None and ceiling==prep_end,'shared')
            if phase not in ('CLEANUP','FINISH'):
                ok(all(states[p]=='SUCCESS' for p in PHASES[:index]),'predecessor')
            active,until,entered = phase,end,at
            seen.add(phase)
            states[phase] = 'UNKNOWN'
        elif get('kind')=='COMPLETED':
            ok(active==phase and get('completed') is True and type(get('exit')) is int,'phase completion')
            ok(row['causePresent']==(get('cause') is not None),'cause presence')
            failed = row['causePresent'] or row['exit']!=0
            late = at>until or at>term
            if phase in ('NORMALIZE','FINISH'):
                spent += at-entered
                late = late or spent>30
            states[phase] = 'FAILURE' if failed else ('UNKNOWN' if late else 'SUCCESS')
            if failed and first is None:first = {'phase':phase,'error':get('cause')}
            active = None
            if states[phase]=='SUCCESS' and phase in ('BUILD','DISCOVERY','PRODUCER'):
                successful_build(get('result'),argv[phase],target/'simgolf-lite')
        else:raise ValueError('event')
    if final is not None:
        if final['firstFailurePresent']:
            ok(type(final.get('firstFailure')) is dict and final['firstFailure'].get('phase') in (*PHASES,'CLOSE','CLEANUP_CLOSE'),'first presence')
            ok(first is None or final['firstFailure']==first,'first cause')
        else:
            ok(final.get('firstFailure') is None and not final['secondaryFailures'] and 'FAILURE' not in states.values(),'false success')
        ok(final.get('auditEvidencePins')==evidence_pins(h,Path(str(root)+'-audit-owner')),'evidence pins')
        if final['at']>term and states['FINISH']=='SUCCESS':states['FINISH']='UNKNOWN'
    trusted = (final is not None and final['ownerClosed'] is True and final['at']<=term and active is None and
               all(v=='SUCCESS' for v in states.values()) and not final['firstFailurePresent'])
    return {'valid':True,'outcomes':states,'trustedLifecycle':trusted,'terminal':final,
            'journalPin':pin}


def finalize(h, driver, target, root, env):
    root = Path(root)
    h['ROLES'].update({JOURNAL:CAP,'held-owner-validation.json':CAP,
                       'build.stdout.log':CAP,'build.stderr.log':CAP})
    try:
        validated = validate(h,driver,target,root,env)
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as error:
        validated = {'valid':False,'outcomes':{p:'UNKNOWN' for p in PHASES},
                     'trustedLifecycle':False,'terminal':None,'error':error_value(error)}
    if not root.exists():root.mkdir(parents=False,exist_ok=False)
    h['wx'](root/'held-owner-validation.json',validated)
    mapped = {**env}
    for phase,outcome in validated['outcomes'].items():
        mapped['OUTCOME_'+phase] = {'SUCCESS':'success','FAILURE':'failure',
                                  'SKIPPED':'skipped','UNKNOWN':'UNKNOWN'}[outcome]
    original_read = h['read_state']
    original_guard = h['source_guard']
    original_wx = h['wx']
    original_inventory = h['inventory']

    def read_state(path):
        state = original_read(path)
        terminal = validated.get('terminal')
        if terminal is not None and terminal['firstFailurePresent']:
            first = terminal['firstFailure']
            h['first_failure'](state,first['phase'],first['error'])
        if not validated['trustedLifecycle']:
            h['first_failure'](state,'held-owner-lifecycle','INVALID_OR_INCOMPLETE_OR_FAILED')
        return state

    def source_guard(repo,expected,pins,owned=None,post=False):
        proof = original_guard(repo,expected,pins,None if post else owned,post)
        if post:
            proof['ok'] = proof['ok'] and not proof['untrackedExtra'] and validated['trustedLifecycle']
            proof['untrackedPostPredicate'] = True
            proof['heldOwnerLifecycleQualified'] = validated['trustedLifecycle']
        return proof

    def wx(path,value,cap=CAP):
        if Path(path).name in ('source-context.json','setup-status.json'):
            value['heldOwnerPhases'] = validated
            value['steps'].update({p:mapped['OUTCOME_'+p] for p in PHASES})
            value['secondaryFailures'] = (validated.get('terminal') or {}).get('secondaryFailures',[])
        return original_wx(path,value,cap)

    def inventory(path):
        value = original_inventory(path)
        terminal = validated.get('terminal')
        value['normalizerEvidence'] = terminal.get('auditEvidencePins') if terminal else None
        value['heldOwnerJournalValid'] = validated['valid']
        value['heldOwnerLifecycleQualified'] = validated['trustedLifecycle']
        return value

    h['read_state'],h['source_guard'],h['wx'],h['inventory'] = read_state,source_guard,wx,inventory
    try:
        return h['finalize'](driver,target,root,mapped)
    finally:
        h['read_state'],h['source_guard'],h['wx'],h['inventory'] = original_read,original_guard,original_wx,original_inventory


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action',choices=['run'])
    parser.parse_args()
    sys.dont_write_bytecode = True
    driver = Path(os.environ['CAPTURE_DRIVER_ROOT'])
    target = Path(os.environ['CAPTURE_TARGET_ROOT'])
    root = Path(os.environ['CAPTURE_ARTIFACT_ROOT'])
    helper = load(driver/'simgolf-lite/scripts/zk1262-capture-phase-driver.py','zk1262_capture_driver')
    return 0 if run(vars(helper),driver,target,root,dict(os.environ)) else 1


if __name__=='__main__':
    raise SystemExit(main())
