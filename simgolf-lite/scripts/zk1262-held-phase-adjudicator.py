"""External fixed-policy eligibility gate. Inert import; ROOT admits execution.

The caller supplies accepted source/policy/role pins independently of the journal.
Linux boot+monotonic binding is mandatory. No timer or closure inference is made.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time

CAP = 32768
PHASES = ('BUILD','NORMALIZE','PREPARE','DISCOVERY','READY','PRODUCER','CLEANUP','FINISH')
POLICY = {'parentTERM':2820,'parentKILL':2880,'build':600,
          'prepareDiscoveryReadyShared':120,'producerTERM':1920,'producerGrace':60,
          'cleanup':60,'normalizeFinishShared':30,'jobMinutes':75,'combinedMinutes':48}
WORKFLOW = '.github/workflows/zk1262-capture-phase.yml'
OWNER = 'simgolf-lite/scripts/zk1262-build-capture-audit-owner.py'
SELF = 'simgolf-lite/scripts/zk1262-held-phase-adjudicator.py'
OWNER_SHA = '9c60ec41141e53525fc77e9ad3d961cd5e95407863c322256ceb1fab7f54dbc0'
HELPER = 'simgolf-lite/scripts/zk1262-capture-phase-driver.py'
HELPER_SHA = '1e26b19b3d35bd1b1ce3dfc829710a45b2616d6a0298cdd00c8207f83cb22e86'
BINDINGS = {OWNER:{'bytes':32767,'sha256':OWNER_SHA},
    'simgolf-lite/scripts/zk1262-build-capture-audit-owner.test.py':
        {'bytes':29020,'sha256':'8d8fb18e7c875cd6e88bd08344816f3fbb283d5040d17ca329c0eecadbc176ef'},
    'simgolf-lite/scripts/zk1262-build-audit-normalization.py':
        {'bytes':17794,'sha256':'75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'},
    'simgolf-lite/scripts/zk1262-build-audit-normalization.test.py':
        {'bytes':13545,'sha256':'f5f1f98606855971a4e17eb5f3897134a6f6dee36c1a11214feaa6a686f50e6d'}}
CLOCK = 'clock_gettime(CLOCK_MONOTONIC)'
BOUNDARY = 'held-phase-prelaunch-boundary.json'
JOURNAL = 'held-owner-phases.jsonl'
PUBLICATION = 'external-phase-adjudication.json'
FINAL = 'external-phase-adjudication-final.json'
IDENTITY_KEYS = ('repository_id','workflow_path','driver_sha','candidate_sha','run_id',
    'run_attempt','policy_sha256','owner_source_sha256','adjudicator_source_sha256',
    'expected_owner_argv','driver_root','target_root','artifact_root')
BOUNDARY_KEYS = set(IDENTITY_KEYS) | {'schemaVersion','kind','monotonic_start',
    'monotonic_clock_kind','boot_identity','boundary_path_dev_ino','created_by_pid',
    'artifact_root_dev_ino','driver_root_dev_ino','target_root_dev_ino',
    'external_root','external_root_dev_ino','artifact_parent_dev_ino'}


def require(value, predicate):
    if not value:raise ValueError(predicate)


def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()


def policy_sha():
    return hashlib.sha256(encoded(POLICY)).hexdigest()


def plain(value):
    count = 0
    def walk(v,depth):
        nonlocal count
        count += 1
        require(depth<=32 and count<=8192,'plain-json-bounds')
        t = type(v)
        if t is dict:
            require(all(type(k) is str for k in v),'plain-json-key')
            for k,x in v.items():walk(k,depth+1);walk(x,depth+1)
        elif t is list:
            for x in v:walk(x,depth+1)
        elif t is float:require(math.isfinite(v),'nonfinite-json-number')
        elif t is int:require(v.bit_length()<=128,'json-integer-cap')
        elif t is str:require(len(v)<=CAP,'json-string-cap')
        else:require(t in (bool,type(None)),'plain-json-type')
    walk(value,0)
    return value


def strict_json(raw):
    require(type(raw) is bytes and 0<len(raw)<=CAP,'json-byte-cap')
    def pairs(items):
        obj = {}
        for key,value in items:
            require(key not in obj,'duplicate-json-key');obj[key] = value
        return obj
    def constant(value):raise ValueError('nonfinite-json-constant')
    try:
        obj = json.loads(raw.decode('utf-8','strict'),object_pairs_hook=pairs,
                         parse_constant=constant)
    except (UnicodeError,RecursionError) as error:raise ValueError('json-decode') from error
    return plain(obj)


def exact(value, expected):
    if type(value) is not type(expected):return False
    if type(expected) is dict:
        return set(value)==set(expected) and all(exact(value[k],v) for k,v in expected.items())
    if type(expected) is list:
        return len(value)==len(expected) and all(exact(a,b) for a,b in zip(value,expected))
    return value==expected


def finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def devino(info):
    return [info.st_dev,info.st_ino]


def snapshot(info):
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def canonical(path):
    path = Path(path)
    require(path.is_absolute() and str(path.resolve())==str(path),'canonical-path')
    for parent in (path,*path.parents):require(not parent.is_symlink(),'path-symlink')
    return path


def directory(path):
    path = canonical(path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode),'directory-kind')
    return devino(info)


def read_file(path):
    path = canonical(path)
    parent = directory(path.parent)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and
            0<before.st_size<=CAP,'regular-single-link-file-cap')
    fd = os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        require(snapshot(os.fstat(fd))==snapshot(before),'opened-file-drift')
        raw = b''
        while len(raw)<=CAP:
            part = os.read(fd,CAP+1-len(raw))
            if not part:break
            raw += part
        require(len(raw)<=CAP and snapshot(os.fstat(fd))==snapshot(before),'file-drift-cap')
    finally:os.close(fd)
    require(snapshot(path.lstat())==snapshot(before) and directory(path.parent)==parent,
            'path-parent-drift')
    return raw,{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                'dev':before.st_dev,'ino':before.st_ino}


def wx(path, value, boundary=False, owned_parent=None):
    path = canonical(path)
    parent = directory(path.parent)
    require(owned_parent is None or exact(parent,owned_parent),'write-owned-parent-drift')
    folder = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    fd = None
    try:
        require(devino(os.fstat(folder))==parent,'write-parent-drift')
        fd = os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                     0o600,dir_fd=folder)
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'write-file-kind')
        if boundary:value = {**value,'boundary_path_dev_ino':devino(info)}
        raw = encoded(value)
        require(len(raw)<=CAP,'output-cap')
        done = 0
        while done<len(raw):
            n = os.write(fd,raw[done:]);require(n>0,'write-progress');done += n
        os.fsync(fd);os.fsync(folder)
        require(devino(os.stat(path.name,dir_fd=folder,follow_symlinks=False))==devino(info)
                and directory(path.parent)==parent,'write-path-drift')
    finally:
        if fd is not None:os.close(fd)
        os.close(folder)
    check,pin = read_file(path)
    require(check==raw,'write-readback')
    return value,pin


def clock_facts():
    info = time.get_clock_info('monotonic')
    require(sys.platform=='linux' and info.monotonic and not info.adjustable and
            info.implementation==CLOCK,'unsupported-monotonic-domain')
    path = Path('/proc/sys/kernel/random/boot_id')
    def boot():
        raw = path.read_bytes()
        require(len(raw)==37 and re.fullmatch(rb'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\n',raw)
                is not None,'missing-boot-binding')
        return raw.decode().strip()
    identity = boot();now = time.monotonic()
    require(boot()==identity and finite(now) and now>=0,'clock-boot-drift')
    return {'monotonic_clock_kind':info.implementation,'boot_identity':identity,'now':now}


def owner_argv(driver):
    return ['timeout','--signal=TERM','--kill-after=60s','2820s','python3',str(driver/OWNER),'run']


def commands(expected):
    return {'BUILD':['npm','run','build'],'NORMALIZE':['AuditOwner.normalize',True],
        'PREPARE':['four-exact-owned-projections','default-sdk-binding'],
        'DISCOVERY':['npx','playwright','test','e2e/zk1262-capture-phase-diagnostic.e2e.ts',
                     '--list','--reporter=line','--workers=1','--retries=0'],
        'READY':['capture-phase-driver.ready'],
        'PRODUCER':['node','scripts/zk1262-run-capture-phase-diagnostic.mjs','--expected-commit',
                    expected['candidate_sha'],'--output',expected['artifact_root']+'/renderer-resource-growth.json'],
        'CLEANUP':['four-owned-dev-ino-only'],'FINISH':['AuditOwner.finish']}


def expected_args(args):
    expected = {key:getattr(args,key) for key in IDENTITY_KEYS if key!='expected_owner_argv'}
    for key in ('repository_id','run_id','run_attempt'):
        raw = expected[key]
        require(re.fullmatch('[0-9]{1,16}',raw) is not None and
                0<int(raw)<=9007199254740991,'caller-positive-identity')
        expected[key] = int(raw)
    require(expected['run_attempt']==1 and expected['workflow_path']==WORKFLOW,'caller-run-workflow')
    for key in ('driver_sha','candidate_sha'):
        require(re.fullmatch('[0-9a-f]{40}',expected[key]) is not None,'caller-commit-sha')
    require(expected['driver_sha']!=expected['candidate_sha'] and
            expected['candidate_sha']=='b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025','caller-exact-candidate')
    for key in ('policy_sha256','owner_source_sha256','adjudicator_source_sha256'):
        require(re.fullmatch('[0-9a-f]{64}',expected[key]) is not None,'caller-source-policy-sha')
    require(expected['policy_sha256']==policy_sha() and expected['owner_source_sha256']==OWNER_SHA,
            'caller-fixed-policy-owner-pin')
    for key in ('driver_root','target_root','artifact_root'):directory(expected[key])
    expected['expected_owner_argv'] = owner_argv(Path(expected['driver_root']))
    require(args.owner_argv==expected['expected_owner_argv'],'caller-exact-owner-argv')
    # Fixed source snapshots bind the journal-producing monotonic implementation.
    for relative,pin in BINDINGS.items():
        _,found = read_file(Path(expected['driver_root'])/relative)
        require({k:found[k] for k in ('bytes','sha256')}==pin,'frozen-source-pin:'+relative)
    _,helper = read_file(Path(expected['driver_root'])/HELPER)
    require(helper['sha256']==HELPER_SHA,'frozen-helper-pin')
    _,source = read_file(Path(expected['driver_root'])/SELF)
    _,running = read_file(Path(__file__).absolute())
    require(source==running and source['sha256']==expected['adjudicator_source_sha256'],
            'caller-adjudicator-source-pin')
    return expected


def external_path(expected):
    legacy = canonical(expected['artifact_root'])
    external = canonical(Path(str(legacy)+'-external'))
    require(external.parent==legacy.parent and external.name==legacy.name+'-external',
            'computed-external-sibling')
    return external


def create_external(expected):
    legacy = canonical(expected['artifact_root']);directory(legacy)
    external = external_path(expected)
    parent_id = directory(legacy.parent)
    parent = os.open(legacy.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    folder = None
    try:
        require(devino(os.fstat(parent))==parent_id,'external-parent-open-drift')
        # Exclusive creation: existing roots/aliases/foreign namespaces cannot be adopted.
        os.mkdir(external.name,mode=0o700,dir_fd=parent)
        folder = os.open(external.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
        root_id = devino(os.fstat(folder))
        os.fsync(folder);os.fsync(parent)
        require(directory(external)==root_id and directory(legacy.parent)==parent_id,
                'external-root-create-drift')
    finally:
        if folder is not None:os.close(folder)
        os.close(parent)
    return external,root_id,parent_id


def external_entries(expected, boundary_pin=None, legacy_pins=None):
    external = external_path(expected)
    root_id = directory(external);parent_id = directory(external.parent)
    names = list(external.iterdir())
    require(len(names)<=3 and all(p.name in (BOUNDARY,PUBLICATION,FINAL) for p in names),
            'external-exact-three-role-namespace')
    for path in names:
        raw,pin = read_file(path);value = strict_json(raw)
        require(type(value) is dict,'external-role-json-object')
        if path.name!=BOUNDARY:
            require(value.get('schemaVersion')==2 and
                    value.get('kind')=='external-fixed-policy-phase-adjudication' and
                    exact(value.get('identity'),expected) and
                    exact(value.get('externalRoot'),{'path':str(external),'dev':root_id[0],
                        'ino':root_id[1],'parentDevIno':parent_id}) and
                    type(value.get('inputPins')) is dict and
                    exact(value['inputPins'].get('external_root'),root_id) and
                    exact(value['inputPins'].get('artifact_parent'),parent_id) and
                    exact(value['inputPins'].get('artifact_root'),directory(expected['artifact_root'])) and
                    (boundary_pin is None or exact(value['inputPins'].get('boundary'),boundary_pin)) and
                    (legacy_pins is None or all(exact(value['inputPins'].get(key),legacy_pins[key])
                                               for key in ('journal','originalValidation'))),
                    'external-existing-verdict-identity-pins')
    require(directory(external)==root_id and directory(external.parent)==parent_id,
            'external-role-root-drift')
    return external,root_id,parent_id


def seal(path, expected):
    path = canonical(path)
    require(path==external_path(expected)/BOUNDARY,'boundary-role-path')
    external,root_id,parent_id = create_external(expected)
    facts = clock_facts()
    value = {**expected,'schemaVersion':2,'kind':'independent-prelaunch-fixed-policy-boundary',
        'monotonic_start':facts['now'],'monotonic_clock_kind':facts['monotonic_clock_kind'],
        'boot_identity':facts['boot_identity'],'created_by_pid':os.getpid(),
        'artifact_root_dev_ino':directory(expected['artifact_root']),
        'driver_root_dev_ino':directory(expected['driver_root']),
        'target_root_dev_ino':directory(expected['target_root']),
        'external_root':str(external),'external_root_dev_ino':root_id,
        'artifact_parent_dev_ino':parent_id}
    value,pin = wx(path,value,boundary=True,owned_parent=root_id)
    require(external_entries(expected)[1:]==(root_id,parent_id),'sealed-external-root-drift')
    return value,pin


def evaluate(rows, boundary, expected, original, facts, pins):
    """Pure bounded predicate consumer; production obtains facts/pins via descriptors.

    A trusted caller/ROOT is responsible for supplying authority, not the journal.
    """
    states = {phase:'UNKNOWN' for phase in PHASES}
    result = {'schemaVersion':2,'kind':'external-fixed-policy-phase-adjudication',
        'valid':False,'bindingQualified':False,'trustedLifecycle':False,'outcomes':states,
        'failedPredicates':[],'metadataDiagnostics':[],'firstFailurePresent':False,
        'firstFailure':None,'secondaryFailures':[],'ownerClosed':False,
        'processClosure':'UNKNOWN','capturePASS':False,'numericalPASS':False,'releaseCleared':False}
    failed = result['failedPredicates']
    def failure(name):
        if name not in failed:failed.append(name)
    try:
        for obj in (rows,boundary,expected,original,facts,pins):plain(obj)
        require(type(rows) is list and 1<=len(rows)<=18,'journal-row-count')
        require(all(type(r) is dict and type(r.get('sequence')) is int and r['sequence']==i
                    for i,r in enumerate(rows)),'journal-sequence')
        # Retain original terminal presence/error values even when authority later fails.
        terminal = rows[-1] if rows[-1].get('kind')=='TERMINAL' else None
        if terminal is not None:
            for key in ('firstFailurePresent','firstFailure','secondaryFailures','ownerClosed'):
                if key in terminal:result[key] = terminal[key]
        require(type(expected) is dict and set(expected)==set(IDENTITY_KEYS),'caller-identity-schema')
        require(expected['policy_sha256']==policy_sha() and expected['owner_source_sha256']==OWNER_SHA
                and expected['workflow_path']==WORKFLOW and expected['run_attempt']==1
                and expected['expected_owner_argv']==owner_argv(Path(expected['driver_root'])),
                'caller-fixed-policy-identity')
        require(type(boundary) is dict and set(boundary)==BOUNDARY_KEYS,'boundary-schema')
        require(boundary['schemaVersion']==2 and type(boundary['schemaVersion']) is int and
                boundary['kind']=='independent-prelaunch-fixed-policy-boundary','boundary-kind')
        require(all(type(boundary[k]) is type(v) and boundary[k]==v for k,v in expected.items()),
                'boundary-identity-policy-source-argv')
        require(boundary['monotonic_clock_kind']==facts['monotonic_clock_kind']==CLOCK and
                boundary['boot_identity']==facts['boot_identity'] and
                re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',boundary['boot_identity'])
                is not None,'boundary-boot-clock-binding')
        require(type(boundary['created_by_pid']) is int and boundary['created_by_pid']>0,
                'boundary-marker-pid-kind')
        require(exact(boundary['boundary_path_dev_ino'],[pins['boundary']['dev'],pins['boundary']['ino']])
                and all(exact(boundary[key+'_dev_ino'],pins[key]) for key in
                        ('artifact_root','driver_root','target_root')),'boundary-dev-ino-drift')
        require(boundary['external_root']==str(Path(expected['artifact_root']+'-external')) and
                Path(boundary['external_root']).parent==Path(expected['artifact_root']).parent and
                exact(boundary['external_root_dev_ino'],pins['external_root']) and
                exact(boundary['artifact_parent_dev_ino'],pins['artifact_parent']),
                'external-bound-root-parent-dev-ino')
        start = boundary['monotonic_start']
        require(finite(start) and start>=0 and finite(facts['now']) and start<=facts['now'],
                'boundary-monotonic-start')
        term,kill = start+POLICY['parentTERM'],start+POLICY['parentKILL']
        result['authoritativeParent'] = {'start':start,'term':term,'kill':kill}
        head = rows[0]
        require(head.get('kind')=='HEADER' and exact(head.get('schemaVersion'),1) and
                head.get('kindRole')=='held-build-audit-owner-phases','journal-header-kind')
        roles = {'candidate_sha':expected['candidate_sha'],'driver_sha':expected['driver_sha'],
            'run_id':expected['run_id'],'run_attempt':expected['run_attempt'],
            'workflow_path':expected['workflow_path'],'mode':'capture-phase-b7fe',
            'artifact_role':'capture-host-phase-ledger'}
        require(exact(head.get('roles'),roles) and exact(head.get('bindings'),BINDINGS) and
                head.get('target')==expected['target_root'] and head.get('root')==expected['artifact_root']
                and head.get('auditEvidence')==expected['artifact_root']+'-audit-owner'
                and exact(head.get('journalIdentity'),[pins['journal']['dev'],pins['journal']['ino']])
                and exact(head.get('rootIdentity'),pins['artifact_root']) and
                head.get('phases')==list(PHASES) and exact(head.get('commands'),commands(expected)),
                'journal-bound-roles-source-paths-argv')
        owner_start = head.get('started')
        require(finite(owner_start) and start<=owner_start<=start+5,'journal-launch-gap')
        require(head.get('parentTermDeadline')==owner_start+2820 and
                exact(head.get('parentTERMSeconds'),2820) and exact(head.get('parentKILLSeconds'),2880),
                'journal-parent-declarations')
        require(type(original) is dict and original.get('valid') is True and
                type(original.get('trustedLifecycle')) is bool and
                exact(original.get('journalPin'),pins['journal']) and
                type(original.get('outcomes')) is dict and set(original['outcomes'])==set(PHASES) and
                all(type(v) is str and v in ('SUCCESS','FAILURE','UNKNOWN','SKIPPED')
                    for v in original['outcomes'].values()),'original-validation-binding')
        result['bindingQualified'] = True
        states.update({phase:'SKIPPED' for phase in PHASES})
        active = None
        seen = set()
        last = owner_start
        prep_end = None
        shared_ceiling = None
        overhead = 0
        first_observed = None
        limits = dict(zip(PHASES,(600,30,120,120,120,1980,60,30)))
        for row in rows[1:]:
            at = row.get('at')
            require(finite(at) and last<=at and at<=facts['now'],'journal-monotonic-order-current')
            require(at<=kill,'authoritative-KILL-refusal')
            last = at
            if row.get('kind')=='TERMINAL':
                require(row is rows[-1] and type(row.get('firstFailurePresent')) is bool and
                        type(row.get('ownerClosed')) is bool and type(row.get('secondaryFailures')) is list,
                        'terminal-position-types')
                continue
            phase = row.get('phase')
            require(phase in PHASES and exact(row.get('argv'),commands(expected)[phase]) and
                    row.get('entered') is True and type(row.get('causePresent')) is bool,'phase-identity')
            if row.get('kind')=='ENTERED':
                require(active is None and phase not in seen and row.get('completed') is False and
                        row.get('exit') is None and row.get('causePresent') is False and
                        row.get('cause') is None,'phase-entry-state')
                index = PHASES.index(phase)
                require(not seen or index>max(PHASES.index(p) for p in seen),'phase-entry-order')
                if phase not in ('CLEANUP','FINISH'):
                    require(all(original['outcomes'][p]=='SUCCESS' for p in PHASES[:index]),'phase-success-predecessors')
                allocation,ceiling,end = row.get('allocation'),row.get('ceiling'),row.get('deadline')
                require(finite(allocation) and 0<allocation<=limits[phase] and
                        (ceiling is None or finite(ceiling) and ceiling<=owner_start+2820) and
                        finite(end) and at<end==min(owner_start+2820,at+allocation,
                                                ceiling if ceiling is not None else owner_start+2820),
                        'phase-declaration-diagnostics')
                bound = min(term,at+limits[phase])
                if phase=='PREPARE':
                    prep_end = min(term,at+120);shared_ceiling = ceiling
                    result['authoritativePrepareEnd'] = prep_end
                if phase in ('PREPARE','DISCOVERY','READY'):
                    require(prep_end is not None and ceiling is not None and ceiling==shared_ceiling,
                            'preparation-declaration-consistency')
                    bound = min(bound,prep_end)
                if end>bound:result['metadataDiagnostics'].append({'phase':phase,'declaredDeadline':end,
                                                                 'authoritativeDeadline':bound})
                if at>bound:failure('late-entry:'+phase)
                if at>term:failure('late-TERM-entry:'+phase)
                active = (phase,at,bound)
                seen.add(phase);states[phase] = 'UNKNOWN'
            elif row.get('kind')=='COMPLETED':
                require(active is not None and active[0]==phase and row.get('completed') is True and
                        type(row.get('exit')) is int and
                        row['causePresent']==(row.get('cause') is not None),'phase-completion-state')
                _,entered,bound = active
                explicit = row['causePresent'] or row['exit']!=0
                late = at>bound or at>term
                if phase in ('NORMALIZE','FINISH'):
                    overhead += at-entered
                    if overhead>30:late = True;failure('shared-normalize-finish-overhead')
                if late:failure('late-completion:'+phase)
                states[phase] = 'FAILURE' if explicit else ('UNKNOWN' if late else 'SUCCESS')
                if explicit and first_observed is None:first_observed = {'phase':phase,'error':row.get('cause')}
                active = None
            else:raise ValueError('journal-event-kind')
        require(terminal is not None,'missing-terminal')
        require(exact(original.get('terminal'),terminal),'original-terminal-binding')
        require(active is None,'missing-phase-completion')
        if terminal['firstFailurePresent']:
            require(type(terminal.get('firstFailure')) is dict and
                    terminal['firstFailure'].get('phase') in (*PHASES,'CLOSE','CLEANUP_CLOSE') and
                    (first_observed is None or exact(terminal['firstFailure'],first_observed)),
                    'terminal-first-failure-preservation')
            failure('original-first-failure')
        else:
            require(terminal.get('firstFailure') is None and not terminal['secondaryFailures'] and
                    first_observed is None,'terminal-false-success')
        if terminal['ownerClosed'] is not True:failure('owner-closure-unobserved')
        if terminal['at']>term:
            failure('late-TERM-terminal')
            if states['FINISH']=='SUCCESS':states['FINISH'] = 'UNKNOWN'
        for phase,old in original['outcomes'].items():
            if old!='SUCCESS':
                states[phase] = old
                failure('original-outcome:'+phase+':'+old)
        if original['trustedLifecycle'] is not True:failure('original-lifecycle-untrusted')
        if not all(v=='SUCCESS' for v in states.values()):failure('incomplete-or-unsuccessful-phases')
        result['normalizeFinishElapsed'] = overhead
        result['valid'] = True
        result['trustedLifecycle'] = not failed and terminal['ownerClosed'] is True
    except (ValueError,KeyError,TypeError,OverflowError,RecursionError) as error:
        failure(str(error)[:256] if type(error) is ValueError else 'malformed:'+type(error).__name__)
    # Preserve every qualified old non-success even on an earlier structural refusal.
    if type(original) is dict and type(original.get('outcomes')) is dict:
        for phase in PHASES:
            old = original['outcomes'].get(phase)
            if type(old) is str and old in ('FAILURE','UNKNOWN','SKIPPED'):
                states[phase] = old
    return result


def adjudicate(path, expected):
    root = canonical(expected['artifact_root'])
    external = external_path(expected)
    require(canonical(path) in (external/PUBLICATION,external/FINAL),'verdict-role-path')
    pins = {}
    facts = clock_facts()
    for key in ('artifact_root','driver_root','target_root'):pins[key] = directory(expected[key])
    boundary_raw,pins['boundary'] = read_file(external/BOUNDARY)
    boundary = strict_json(boundary_raw)
    external,pins['external_root'],pins['artifact_parent'] = external_entries(expected,pins['boundary'])
    require(type(boundary) is dict and boundary.get('schemaVersion')==2 and
            boundary.get('external_root')==str(external) and
            exact(boundary.get('external_root_dev_ino'),pins['external_root']) and
            exact(boundary.get('artifact_parent_dev_ino'),pins['artifact_parent']) and
            exact(boundary.get('artifact_root_dev_ino'),pins['artifact_root']) and
            exact(boundary.get('boundary_path_dev_ino'),[pins['boundary']['dev'],pins['boundary']['ino']]),
            'external-owned-layout-refusal')
    journal_raw,pins['journal'] = read_file(root/JOURNAL)
    original_raw,pins['originalValidation'] = read_file(root/'held-owner-validation.json')
    require(journal_raw.endswith(b'\n'),'journal-truncated-tail')
    lines = journal_raw.splitlines()
    require(1<=len(lines)<=18 and all(lines),'journal-line-count')
    rows = [strict_json(line) for line in lines]
    original = strict_json(original_raw)
    value = evaluate(rows,boundary,expected,original,facts,pins)
    value['inputPins'] = pins
    value['identity'] = expected
    value['externalRoot'] = {'path':str(external),'dev':pins['external_root'][0],
                            'ino':pins['external_root'][1],'parentDevIno':pins['artifact_parent']}
    # Snapshot readback refuses mutation during this bounded ordinary receipt operation.
    for file,pin in ((external/BOUNDARY,pins['boundary']),(root/JOURNAL,pins['journal']),
                     (root/'held-owner-validation.json',pins['originalValidation'])):
        require(read_file(file)[1]==pin,'adjudication-input-drift')
    require(clock_facts()['boot_identity']==facts['boot_identity'],'adjudication-boot-drift')
    require(external_entries(expected,pins['boundary'],pins)[1:]==(pins['external_root'],pins['artifact_parent']),
            'adjudication-external-root-drift')
    wx(path,value,owned_parent=pins['external_root'])
    external_entries(expected,pins['boundary'],pins)
    return value['valid'] and value['bindingQualified'] and value['trustedLifecycle']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('seal','adjudicate'))
    for key in IDENTITY_KEYS:
        if key!='expected_owner_argv':parser.add_argument('--'+key.replace('_','-'),required=True)
    parser.add_argument('--output',required=True)
    args,argv = parser.parse_known_args()
    args.owner_argv = argv
    if args.owner_argv and args.owner_argv[0]=='--':args.owner_argv.pop(0)
    try:
        expected = expected_args(args)
        if args.action=='seal':seal(args.output,expected);return 0
        return 0 if adjudicate(args.output,expected) else 1
    except (ValueError,OSError,KeyError,TypeError,OverflowError,RecursionError) as error:
        # No fabricated boundary/verdict when authority or input parsing is unavailable.
        print('external phase gate refused: '+type(error).__name__+': '+str(error)[:256],file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
