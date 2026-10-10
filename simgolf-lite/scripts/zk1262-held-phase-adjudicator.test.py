"""Focused ROOT-only offline controls. No capture/build/owner-run/Git/network.

ROOT must bound this worker120s / parent180s / stdio262144 / artifacts8MiB.
The old reader uses synthetic source/Git seams, never edited source or monkeypatch.
Production clock acquisition has no seam selector; fake facts exist only here.
"""
import copy
import hashlib
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
OUT = Path(os.environ['ZK1316_TEST_OUT'])
OUT.mkdir(mode=0o700)


def load(variable,name):
    path = Path(os.environ[variable])
    raw = path.read_bytes()
    if len(raw)>32768 or hashlib.sha256(raw).hexdigest()!=os.environ[variable+'_SHA256']:
        raise RuntimeError('pinned control source:'+variable)
    spec = importlib.util.spec_from_file_location(name,path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load('ZK1316_ADJUDICATOR_MODULE','external_phase_actual')
h = load('ZK1316_HELPER_MODULE','frozen_helper_actual')
if os.environ['ZK1316_HELPER_MODULE_SHA256']!=m.HELPER_SHA:raise RuntimeError('frozen helper pin')
old = load('ZK1316_OWNER_MODULE','frozen_held_actual')
if hashlib.sha256(Path(os.environ['ZK1316_OWNER_MODULE']).read_bytes()).hexdigest()!=m.OWNER_SHA:
    raise RuntimeError('frozen owner source3 identity')


def workflow_file(variable):
    path = Path(os.environ[variable]);raw = path.read_bytes()
    if len(raw)>32768 or hashlib.sha256(raw).hexdigest()!=os.environ[variable+'_SHA256']:
        raise RuntimeError('workflow pin:'+variable)
    return raw.decode()


WORKFLOW = workflow_file('ZK1316_WORKFLOW')
BASE = workflow_file('ZK1316_BASE_WORKFLOW')


def run_block(text,name):
    part = text.split('      - name: '+name+'\n',1)[1].split('      - name:',1)[0]
    return '\n'.join(line[10:] for line in part.split('        run: |\n',1)[1].splitlines())+'\n'


PUBLICATION_NAME = 'Always neutral post-source status and bounded role inventory'
FINAL_NAME = 'Preserve strict whole-run failure disposition'
HELD_NAME = 'Held audit owner; original build, capture preparation and original producer'


def wiring(text):
    if text.count('zk1262-held-phase-adjudicator.py" seal \\')!=1:return False
    if text.count('zk1262-held-phase-adjudicator.py" adjudicate \\')!=2:return False
    if 'continue-on-error:' in text:return False
    held = run_block(text,HELD_NAME)
    original = 'timeout --signal=TERM --kill-after=60s 2820s python3 "$CAPTURE_DRIVER_ROOT/simgolf-lite/scripts/zk1262-build-capture-audit-owner.py" run\n'
    if held.count('\n'+original)!=1 or held.index('" seal')>=held.index('\n'+original):return False
    for name,output in ((PUBLICATION_NAME,m.PUBLICATION),(FINAL_NAME,m.FINAL)):
        section = text.split('      - name: '+name+'\n',1)[1].split('      - name:',1)[0]
        if '        if: always()\n' not in section:return False
        block = run_block(text,name)
        if 'zk1262-held-phase-adjudicator.py" adjudicate \\' not in block:return False
        if '--output "$CAPTURE_ARTIFACT_ROOT-external/'+output+'"' not in block:return False
        if 'gate_code=$?\n' not in block or not block.endswith('exit "$gate_code"\n'):return False
    return 'name: zk1316-external-phase-' in text and all(name in text for name in (m.BOUNDARY,m.PUBLICATION,m.FINAL))


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(dir=OUT)
        self.base = Path(self.temp.name)
        self.driver,self.target,self.root = (self.base/name for name in ('driver','target','raw'))
        for path in (self.driver,self.target,self.root):path.mkdir()
        self.external=Path(str(self.root)+'-external')
        self.expected = {'repository_id':17,'workflow_path':m.WORKFLOW,'driver_sha':'2'*40,
            'candidate_sha':'b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025','run_id':123,'run_attempt':1,
            'policy_sha256':m.policy_sha(),'owner_source_sha256':m.OWNER_SHA,
            'adjudicator_source_sha256':os.environ['ZK1316_ADJUDICATOR_MODULE_SHA256'],
            'driver_root':str(self.driver),'target_root':str(self.target),'artifact_root':str(self.root),
            'expected_owner_argv':m.owner_argv(self.driver)}
        self.facts = {'monotonic_clock_kind':m.CLOCK,'boot_identity':'11111111-2222-3333-4444-555555555555',
                      'now':100.25}
        with patch.object(m,'clock_facts',return_value=self.facts):
            self.boundary,_ = m.seal(self.external/m.BOUNDARY,self.expected)
        self.facts['now'] = 10000.25
        self.roles = {'candidate_sha':self.expected['candidate_sha'],'driver_sha':'2'*40,
            'run_id':123,'run_attempt':1,'workflow_path':m.WORKFLOW,'mode':'capture-phase-b7fe',
            'artifact_role':'capture-host-phase-ledger'}
        # Source/Git seams are confined to the frozen validator's existing helper interface.
        def file_bytes(path,cap):
            relative = str(path.relative_to(self.driver)) if path.is_relative_to(self.driver) else None
            if relative in m.BINDINGS:
                raw = ('synthetic-source:'+relative).encode()
                return raw,{**m.BINDINGS[relative],'dev':1,'ino':1}
            return m.read_file(path)
        self.h = {'file_bytes':file_bytes,'strict_json':lambda raw,cap=32768:m.strict_json(raw),
            'roles':lambda env:self.roles,'CANDIDATE':self.expected['candidate_sha'],
            'driver_guard':lambda *args:None,
            'git':lambda driver,action,ref:('synthetic-source:'+ref.split(':',1)[1]).encode()}
        self.make()

    def make(self,durations=None,write=True):
        durations = durations or {}
        argv = m.commands(self.expected)
        head = {'sequence':0,'kind':'HEADER','schemaVersion':1,'kindRole':'held-build-audit-owner-phases',
            'roles':self.roles,'bindings':copy.deepcopy(m.BINDINGS),'target':str(self.target),
            'root':str(self.root),'auditEvidence':str(self.root)+'-audit-owner','phases':list(m.PHASES),
            'commands':argv,'started':100.5,'parentTermDeadline':2920.5,'parentTERMSeconds':2820,
            'parentKILLSeconds':2880,'journalIdentity':[0,0],'rootIdentity':m.directory(self.root)}
        self.rows = [head]
        now = 101.0
        prep = None
        overhead = 0
        for phase,cap in zip(m.PHASES,(600,30,120,120,120,1980,60,30)):
            if phase=='PREPARE':prep = now+120
            allocation = cap if phase!='FINISH' else 30-overhead
            ceiling = prep if phase in ('PREPARE','DISCOVERY','READY') else None
            end = min(2920.5,now+allocation,ceiling if ceiling is not None else 2920.5)
            self.rows.append({'sequence':len(self.rows),'kind':'ENTERED','phase':phase,'at':now,
                'argv':argv[phase],'entered':True,'completed':False,'exit':None,'causePresent':False,
                'cause':None,'deadline':end,'allocation':allocation,'ceiling':ceiling})
            duration = durations.get(phase,1.0)
            now += duration
            if phase in ('NORMALIZE','FINISH'):overhead += duration
            result = {'kind':'ACTUAL_CHILD_WAIT','argv':argv[phase],'cwd':str(self.target/'simgolf-lite'),
                      'waited':True,'timeout':False,'exitCode':0}
            self.rows.append({'sequence':len(self.rows),'kind':'COMPLETED','phase':phase,'at':now,
                'argv':argv[phase],'entered':True,'completed':True,'exit':0,'causePresent':False,
                'cause':None,'result':result})
        self.rows.append({'sequence':len(self.rows),'kind':'TERMINAL','at':now,
            'firstFailurePresent':False,'firstFailure':None,'secondaryFailures':[],'ownerClosed':True,
            'auditEvidencePins':None,'processClosure':'UNKNOWN'})
        if write:self.write()

    def write(self):
        path = self.root/m.JOURNAL
        if not path.exists():path.write_bytes(b'x')
        self.rows[0]['journalIdentity'] = m.devino(path.stat())
        path.write_bytes(b''.join(m.encoded(row) for row in self.rows))
        self.original = old.validate(self.h,self.driver,self.target,self.root,
                                     {'CAPTURE_SOURCE_SHA':'2'*40})
        (self.root/'held-owner-validation.json').write_bytes(m.encoded(self.original))
        self.pins = {'journal':m.read_file(path)[1],
            'boundary':m.read_file(self.external/m.BOUNDARY)[1],
            'external_root':m.directory(self.external),'artifact_parent':m.directory(self.root.parent),
            'artifact_root':m.directory(self.root),'driver_root':m.directory(self.driver),
            'target_root':m.directory(self.target)}

    def evaluate(self):
        return m.evaluate(copy.deepcopy(self.rows),copy.deepcopy(self.boundary),copy.deepcopy(self.expected),
                          copy.deepcopy(self.original),copy.deepcopy(self.facts),copy.deepcopy(self.pins))

    def event(self,phase,kind):
        return next(row for row in self.rows if row.get('phase')==phase and row['kind']==kind)

    def close(self):self.temp.cleanup()


class Tests(unittest.TestCase):
    def setUp(self):self.fixtures=[]
    def tearDown(self):
        for fixture in reversed(self.fixtures):fixture.close()
    def fixture(self):
        fixture=Fixture();self.fixtures.append(fixture);return fixture
    def green(self,f):
        self.assertTrue(f.original['trustedLifecycle'])
        value=f.evaluate();self.assertTrue(value['valid'],value);self.assertTrue(value['bindingQualified'],value)
        self.assertTrue(value['trustedLifecycle'],value);return value
    def red(self,f):
        value=f.evaluate();self.assertFalse(value['trustedLifecycle'],value);return value

    def test_01_honest_fractional_clock_and_smaller_allocations(self):
        f=self.fixture()
        for row in f.rows:
            if row['kind']=='ENTERED' and row['phase'] not in ('FINISH',):
                row['allocation']=10.25
                row['deadline']=min(2920.5,row['at']+10.25,row['ceiling'] or 2920.5)
        f.write();result=self.green(f)
        self.assertEqual(result['authoritativeParent']['start'],100.25)
        self.assertEqual(result['processClosure'],'UNKNOWN')
        self.assertIs(result['capturePASS'],False)

    def test_02_common_ceiling_forgery_old_GREEN_external_RED(self):
        f=self.fixture()
        # PREPARE entered103: fixed shared end223. Consistent forged ceiling300 lets old reader pass.
        times={'DISCOVERY':(220,230),'READY':(231,232),'PRODUCER':(233,234),
               'CLEANUP':(235,236),'FINISH':(237,238)}
        for row in f.rows:
            phase=row.get('phase')
            if phase in times:row['at']=times[phase][row['kind']=='COMPLETED']
            if row['kind']=='ENTERED':
                if phase in ('PREPARE','DISCOVERY','READY'):row['ceiling']=300
                row['deadline']=min(2920.5,row['at']+row['allocation'],row['ceiling'] or 2920.5)
        f.rows[-1]['at']=238;f.write()
        self.assertTrue(f.original['trustedLifecycle'])
        result=self.red(f)
        self.assertEqual(result['outcomes']['DISCOVERY'],'UNKNOWN')
        self.assertEqual(result['outcomes']['READY'],'UNKNOWN')
        self.assertIn('late-completion:DISCOVERY',result['failedPredicates'])

    def test_03_exact_build_producer_cleanup_and_shared120_bounds(self):
        for phase,cap in (('BUILD',600),('PRODUCER',1980),('CLEANUP',60)):
            for epsilon in (0,0.000001):
                with self.subTest(phase=phase,epsilon=epsilon):
                    f=self.fixture();f.make({phase:cap+epsilon},write=False)
                    if epsilon and phase=='BUILD':
                        f.rows=[r for r in f.rows if r.get('phase') in (None,'BUILD','CLEANUP','FINISH')]
                        for index,row in enumerate(f.rows):row['sequence']=index
                    f.write()
                    if epsilon:
                        # Preserve original unknown; this control does not claim old GREEN.
                        result=self.red(f);self.assertEqual(result['outcomes'][phase],'UNKNOWN')
                    else:self.green(f)
        f=self.fixture();f.make({'PREPARE':40,'DISCOVERY':40,'READY':40});self.green(f)
        f=self.fixture();f.make({'PREPARE':40,'DISCOVERY':40,'READY':40.000001},write=False)
        f.rows=[r for r in f.rows if r.get('phase')!='PRODUCER']
        for index,row in enumerate(f.rows):row['sequence']=index
        f.write();self.assertEqual(self.red(f)['outcomes']['READY'],'UNKNOWN')

    def test_04_exact_and_late_normalize_finish_shared30(self):
        for epsilon in (0,0.000001):
            f=self.fixture();f.make({'NORMALIZE':15,'FINISH':15+epsilon})
            if epsilon:
                result=self.red(f)
                self.assertIn('shared-normalize-finish-overhead',result['failedPredicates'])
            else:self.assertEqual(self.green(f)['normalizeFinishElapsed'],30)

    def test_05_marker_parent_TERM_equality_and_epsilon_old_GREEN(self):
        for epsilon in (0,0.000001):
            f=self.fixture()
            enter,complete=f.event('FINISH','ENTERED'),f.event('FINISH','COMPLETED')
            enter['at']=2919.25;enter['deadline']=2920.5
            complete['at']=2920.25+epsilon;f.rows[-1]['at']=complete['at'];f.write()
            self.assertTrue(f.original['trustedLifecycle'])
            if epsilon:self.assertEqual(self.red(f)['outcomes']['FINISH'],'UNKNOWN')
            else:self.green(f)

    def test_06_KILL_equality_and_epsilon_refusal(self):
        for epsilon in (0,0.000001):
            f=self.fixture();f.rows[-1]['at']=2980.25+epsilon;f.write()
            result=self.red(f)
            self.assertEqual(result['valid'],not bool(epsilon))
            self.assertFalse(result['trustedLifecycle'])
            if epsilon:self.assertIn('authoritative-KILL-refusal',result['failedPredicates'])

    def test_07_boundary_required_identity_policy_clock_boot_and_devino(self):
        for key in sorted(m.BOUNDARY_KEYS):
            with self.subTest(missing=key):
                f=self.fixture();del f.boundary[key]
                self.assertFalse(self.red(f)['bindingQualified'])
        for key,value in (('repository_id',18),('run_id',124),('run_attempt',2),('driver_sha','3'*40),
            ('candidate_sha','4'*40),('workflow_path','foreign.yml'),('owner_source_sha256','f'*64),
            ('adjudicator_source_sha256','f'*64),('policy_sha256','f'*64),
            ('boot_identity','22222222-2222-3333-4444-555555555555'),
            ('monotonic_clock_kind','foreign-clock'),('expected_owner_argv',['true']),
            ('boundary_path_dev_ino',[1,1]),('artifact_root_dev_ino',[1,1]),
            ('driver_root_dev_ino',[1,1]),('target_root_dev_ino',[1,1])):
            with self.subTest(drift=key):
                f=self.fixture();f.boundary[key]=value
                self.assertFalse(self.red(f)['bindingQualified'])
        f=self.fixture();f.facts['boot_identity']='foreign';self.red(f)
        f=self.fixture();f.facts['monotonic_clock_kind']='foreign';self.red(f)

    def test_08_preboundary_header_launchgap_and_foreign_source_argv(self):
        for start in (100.249999,105.250001):
            f=self.fixture();f.rows[0]['started']=start;f.rows[0]['parentTermDeadline']=start+2820
            result=self.red(f);self.assertIn('journal-launch-gap',result['failedPredicates'])
        for key,value in (('bindings',{}),('roles',{}),('root','foreign'),('commands',{}),
                          ('journalIdentity',[1,1]),('rootIdentity',[1,1])):
            f=self.fixture();f.rows[0][key]=value;self.red(f)
        f=self.fixture();f.event('PRODUCER','COMPLETED')['argv']=['foreign'];self.red(f)

    def test_09_duplicate_nonfinite_plain_and_input_bounds(self):
        for raw in (b'{"x":1,"x":2}',b'{"nested":{"x":1,"x":2}}',b'{"x":NaN}',
                    b'{"x":Infinity}',b'{"x":1e999}',b'{} {}',b'\xff',b' '*(m.CAP+1)):
            with self.subTest(raw=raw[:30]):
                with self.assertRaises((ValueError,json.JSONDecodeError)):m.strict_json(raw)
        class Foreign(dict):pass
        f=self.fixture();rows=copy.deepcopy(f.rows);rows[0]=Foreign(rows[0])
        result=m.evaluate(rows,f.boundary,f.expected,f.original,f.facts,f.pins)
        self.assertFalse(result['trustedLifecycle'])
        f=self.fixture();f.boundary['monotonic_start']=float('nan');self.red(f)
        f=self.fixture();f.rows.append(copy.deepcopy(f.rows[-1]));self.red(f)
        f=self.fixture();f.rows[1]['sequence']=1.0;self.red(f)
        f=self.fixture();f.rows[0]['schemaVersion']=True;self.red(f)
        f=self.fixture();f.rows[0]['roles']['run_attempt']=True;self.red(f)
        f=self.fixture();f.rows[0]['commands']['NORMALIZE']=['AuditOwner.normalize',1];self.red(f)

    def test_10_missing_terminal_completion_and_owner_closure(self):
        f=self.fixture();f.rows.pop();f.write()
        self.assertIn('missing-terminal',self.red(f)['failedPredicates'])
        f=self.fixture();f.rows[-1]['ownerClosed']=False;f.write()
        self.assertIn('owner-closure-unobserved',self.red(f)['failedPredicates'])
        f=self.fixture();f.rows.pop(-2)
        for index,row in enumerate(f.rows):row['sequence']=index
        f.write();self.assertIn('missing-phase-completion',self.red(f)['failedPredicates'])

    def test_11_first_falsy_secondary_and_original_unknown_never_upgraded(self):
        f=self.fixture()
        false_error={'type':'FalseyError','message':'first','cause':False,'formatErrors':[]}
        close_error={'phase':'CLOSE','error':{'type':'Error','message':'secondary','cause':0,'formatErrors':[]}}
        row=f.event('FINISH','COMPLETED');row.update({'exit':1,'causePresent':True,'cause':false_error})
        f.rows[-1].update({'firstFailurePresent':True,
            'firstFailure':{'phase':'FINISH','error':false_error},'secondaryFailures':[close_error]})
        f.write();result=self.red(f)
        self.assertIs(result['firstFailure']['error']['cause'],False)
        self.assertEqual(result['secondaryFailures'],[close_error])
        self.assertEqual(result['outcomes']['FINISH'],'FAILURE')
        for outcome in ('UNKNOWN','FAILURE','SKIPPED'):
            f=self.fixture();f.original['outcomes']['PRODUCER']=outcome
            f.original['trustedLifecycle']=False
            result=self.red(f);self.assertEqual(result['outcomes']['PRODUCER'],outcome)
        f=self.fixture();f.original['journalPin']['sha256']='f'*64
        self.assertFalse(self.red(f)['bindingQualified'])

    def test_12_real_boundary_wx_collision_inode_alias_oversize_and_verdict_revalidation(self):
        f=self.fixture()
        with self.assertRaises(FileExistsError):m.wx(f.external/m.BOUNDARY,f.boundary,boundary=True)
        original=f.external/m.BOUNDARY;original.rename(f.external/'old-boundary')
        original.write_bytes(m.encoded(f.boundary));f.pins['boundary']=m.read_file(original)[1]
        self.assertIn('boundary-dev-ino-drift',self.red(f)['failedPredicates'])
        alias=f.external/'alias';alias.symlink_to(original)
        with self.assertRaises(ValueError):m.read_file(alias)
        alias.unlink();os.link(original,alias)
        with self.assertRaises(ValueError):m.read_file(original)
        alias.unlink()
        f=self.fixture()
        with patch.object(m,'clock_facts',return_value=f.facts):
            self.assertTrue(m.adjudicate(f.external/m.PUBLICATION,f.expected))
            self.assertTrue(m.adjudicate(f.external/m.FINAL,f.expected))
            with self.assertRaises(FileExistsError):m.adjudicate(f.external/m.PUBLICATION,f.expected)
        f=self.fixture();(f.external/m.BOUNDARY).unlink()
        with patch.object(m,'clock_facts',return_value=f.facts),self.assertRaises(FileNotFoundError):
            m.adjudicate(f.external/m.PUBLICATION,f.expected)

    def test_13_mandatory_workflow_missing_bypassed_replaced_fail(self):
        self.assertTrue(wiring(WORKFLOW))
        for mutation in (WORKFLOW.replace('zk1262-held-phase-adjudicator.py" adjudicate','other.py" adjudicate',1),
            WORKFLOW.replace('gate_code=$?','gate_code=0',1),
            WORKFLOW.replace('exit "$gate_code"','exit 0',1),
            WORKFLOW.replace('        if: always()','        if: success()',1),
            WORKFLOW.replace('zk1262-held-phase-adjudicator.py" seal','other.py" seal',1),
            WORKFLOW.replace('        shell: bash','        continue-on-error: true\n        shell: bash',1)):
            self.assertFalse(wiring(mutation))
        self.assertNotIn('external-phase-adjudication',BASE)
        legacy=BASE.split('      - name: Upload only strict known existing diagnostic roles',1)[1].split('      - name:',1)[0]
        self.assertIn(legacy,WORKFLOW)
        self.assertEqual(hashlib.sha256(BASE.encode()).hexdigest(),
                         '596e5d8aa549b4d01422763ec6e7c885ae6b41ff6f238043a0fd3fb51afe09cb')
        self.assertEqual(m.POLICY,{'parentTERM':2820,'parentKILL':2880,'build':600,
            'prepareDiscoveryReadyShared':120,'producerTERM':1920,'producerGrace':60,'cleanup':60,
            'normalizeFinishShared':30,'jobMinutes':75,'combinedMinutes':48})
        self.assertIn('    timeout-minutes: 75',WORKFLOW)
        self.assertIn('        timeout-minutes: 48',WORKFLOW)
        module_sha=os.environ['ZK1316_ADJUDICATOR_MODULE_SHA256']
        self.assertIn('CAPTURE_ADJUDICATOR_SHA256: '+module_sha,WORKFLOW)
        self.assertIn('CAPTURE_FIXED_POLICY_SHA256: '+m.policy_sha(),WORKFLOW)

    def test_14_actual_shell_gate_status_old_GREEN_external_RED_and_helper_failure(self):
        f=self.fixture()
        helper=f.driver/m.HELPER;helper.parent.mkdir(parents=True);helper.write_text('synthetic CLI stub')
        bindir=f.base/'bin';bindir.mkdir()
        executable=bindir/'python3'
        executable.write_text('#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$STUB_LOG"\n'
            'case "$1" in *zk1262-held-phase-adjudicator.py) exit "$GATE_STUB_CODE";; '
            '*zk1262-capture-phase-driver.py) exit "$OLD_STUB_CODE";; '
            '-) exec "$STUB_REAL_PYTHON" "$@";; *) exit 99;; esac\n')
        executable.chmod(0o700)
        env={**os.environ,'PATH':str(bindir)+os.pathsep+os.environ.get('PATH',''),
            'CAPTURE_DRIVER_ROOT':str(f.driver),'CAPTURE_TARGET_ROOT':str(f.target),
            'CAPTURE_ARTIFACT_ROOT':str(f.root),'CAPTURE_REPOSITORY_ID':'17',
            'CAPTURE_CANDIDATE_SHA':f.expected['candidate_sha'],'GITHUB_SHA':'2'*40,
            'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','CAPTURE_FIXED_POLICY_SHA256':m.policy_sha(),
            'CAPTURE_ADJUDICATOR_SHA256':os.environ['ZK1316_ADJUDICATOR_MODULE_SHA256'],
            'STUB_REAL_PYTHON':sys.executable}
        serial=0
        cases=[]

        def execute(name,oldcode,gatecode,expected_code,expected_calls,overrides=None):
            nonlocal serial
            label='test14-case-'+str(serial).zfill(2)
            serial+=1
            log=f.base/'calls';log.write_bytes(b'')
            case_env={**env,'STUB_LOG':str(log),'OLD_STUB_CODE':str(oldcode),
                      'GATE_STUB_CODE':str(gatecode),**(overrides or {})}
            script=run_block(WORKFLOW,name)
            try:
                run=subprocess.run(['bash','-c',script],cwd=f.base,env=case_env,
                    stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
                code,stdout,stderr,timed_out=run.returncode,run.stdout,run.stderr,False
            except subprocess.TimeoutExpired as error:
                code,stdout,stderr,timed_out=None,error.stdout or b'',error.stderr or b'',True
            lines=log.read_text().splitlines()
            # Retain bounded stdout/stderr for every case before any assertion fails.
            streams={}
            for role,raw in (('stdout',stdout),('stderr',stderr)):
                path=OUT/(label+'.'+role+'.log')
                bounded=raw[:32768]
                with path.open('xb') as output:output.write(bounded)
                streams[role]={'path':str(path),'observedBytes':len(raw),'retainedBytes':len(bounded),
                    'truncated':len(raw)>len(bounded),'sha256':hashlib.sha256(bounded).hexdigest()}
            passed=(not timed_out and len(stdout)+len(stderr)<=32768 and
                    code==expected_code and lines==expected_calls)
            diagnostic={'name':name,'oldCode':oldcode,'gateCode':gatecode,'expectedExit':expected_code,
                'actualExit':code,'timeoutSeconds':5,'timedOut':timed_out,'passed':passed,
                'scriptSha256':hashlib.sha256(script.encode()).hexdigest(),
                'expectedCalls':expected_calls,'actualCalls':lines,'streams':streams,
                'qualification':'Synthetic CLI status controls; helper-missing neutral heredoc uses real Python only. No capture/build/Git/network or production authority claim.'}
            path=OUT/(label+'.json');raw=m.encoded(diagnostic)
            self.assertLessEqual(len(raw),32768)
            with path.open('xb') as output:output.write(raw)
            cases.append({'path':str(path),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                          'passed':passed})
            # Summary remains available even if an assertion or later case fails.
            summary=m.encoded({'unit':'test14-workflow-shell-status','cases':cases,
                               'allPassed':all(case['passed'] for case in cases)})
            self.assertLessEqual(len(summary),32768)
            (OUT/'test14-diagnostics-index.json').write_bytes(summary)
            message='diagnostics retained at '+str(path)
            self.assertFalse(timed_out,message)
            self.assertLessEqual(len(stdout)+len(stderr),32768,message)
            self.assertEqual(code,expected_code,message)
            self.assertEqual(lines,expected_calls,message)
            return diagnostic

        for name in (PUBLICATION_NAME,FINAL_NAME):
            for oldcode,gatecode in ((0,0),(0,7),(13,0),(13,7),(0,127)):
                with self.subTest(name=name,oldcode=oldcode,gatecode=gatecode):
                    old_call=str(helper)+' '+('finalize' if name==PUBLICATION_NAME else 'verdict')
                    gate_call=str(f.driver/m.SELF)+' adjudicate'
                    expected_calls=[old_call,gate_call] if name==PUBLICATION_NAME else [gate_call,old_call]
                    execute(name,oldcode,gatecode,oldcode or gatecode,expected_calls)

        helper.unlink()
        for gatecode in (0,7,127):
            with self.subTest(name=PUBLICATION_NAME,helperMissing=True,gatecode=gatecode):
                neutral=f.base/('neutral-helper-missing-'+str(gatecode))
                expected_calls=['- ',str(f.driver/m.SELF)+' adjudicate']
                execute(PUBLICATION_NAME,0,gatecode,1,expected_calls,
                        {'CAPTURE_ARTIFACT_ROOT':str(neutral)})
                for filename in ('source-context.json','inventory.json'):
                    path=neutral/filename
                    self.assertTrue(path.is_file())
                    raw=path.read_bytes();self.assertLessEqual(len(raw),32768)
                    value=m.strict_json(raw)
                    self.assertIs(value['capturePASS'],False)
                    self.assertIs(value['numericalPASS'],False)
                    self.assertIs(value['releaseCleared'],False)
                self.assertIs(m.strict_json((neutral/'inventory.json').read_bytes())['wholeRunFailed'],True)
                self.assertEqual(m.strict_json((neutral/'source-context.json').read_bytes())['processClosure'],
                                 'UNKNOWN')

    def test_15_actual_frozen_inventory_sibling_GREEN_same_root_donor_RED_unknown_RED(self):
        f=self.fixture();legacy=f.base/'inventory-legacy';legacy.mkdir()
        expected={**f.expected,'artifact_root':str(legacy)}
        sibling=Path(str(legacy)+'-external')
        for name in ('source-context.json','renderer-resource-growth-command.json','zk682-capture-phase-ledger.json'):
            (legacy/name).write_bytes(m.encoded({'capturePASS':False}))
        with patch.object(m,'clock_facts',return_value=f.facts):m.seal(sibling/m.BOUNDARY,expected)
        for name in (m.PUBLICATION,m.FINAL):m.wx(sibling/name,{'trustedLifecycle':False})
        role_schema=copy.deepcopy(h.ROLES)
        positive=h.inventory(legacy)  # Actual frozen inventory, no stub or ROLES mutation.
        self.assertEqual(h.ROLES,role_schema)
        self.assertEqual(len(positive['entries']),3)
        self.assertEqual(positive['missingRequiredDiagnosticRoles'],[])
        for field in ('diagnosticReady','capturePASS','numericalPASS','releaseCleared'):
            self.assertIs(positive[field],False)
        with (OUT/'layout-inventory-positive.json').open('xb') as out:out.write(m.encoded(positive))
        donor=legacy/m.BOUNDARY;donor.write_bytes((sibling/m.BOUNDARY).read_bytes())
        with self.assertRaisesRegex(ValueError,'unexpected artifact role/path'):h.inventory(legacy)
        donor.unlink();unknown=legacy/'foreign-role.json';unknown.write_bytes(b'{}\n')
        with self.assertRaisesRegex(ValueError,'unexpected artifact role/path'):h.inventory(legacy)
        with (OUT/'layout-inventory-donor-refusals.json').open('xb') as out:
            out.write(m.encoded({'sameRootSource2Donor':'RED','unknownRole':'RED',
                                'actualHelperSha256':m.HELPER_SHA,'ROLESUnchanged':h.ROLES==role_schema}))

    def test_16_external_layout_identity_namespace_and_foreign_root_refusals(self):
        for key,value in (('external_root','/foreign'),('external_root_dev_ino',[1,1]),
                          ('artifact_parent_dev_ino',[1,1]),('artifact_root_dev_ino',[1,1]),
                          ('driver_sha','3'*40),('candidate_sha','4'*40),('run_id',999)):
            f=self.fixture();f.boundary[key]=value;self.assertFalse(self.red(f)['bindingQualified'])
        f=self.fixture()
        with self.assertRaises(ValueError):m.seal(f.root/m.BOUNDARY,f.expected)
        self.assertFalse((f.root/m.BOUNDARY).exists())
        before=(f.external/m.BOUNDARY).read_bytes()
        with self.assertRaises(FileExistsError):m.seal(f.external/m.BOUNDARY,f.expected)
        self.assertEqual((f.external/m.BOUNDARY).read_bytes(),before)
        with patch.object(m,'clock_facts',return_value=f.facts),self.assertRaises(ValueError):
            m.adjudicate(f.root/m.PUBLICATION,f.expected)
        (f.external/'foreign.json').write_bytes(b'{}\n')
        with self.assertRaises(ValueError):m.external_entries(f.expected)
        f=self.fixture();saved=f.base/'saved-external';f.external.rename(saved);f.external.symlink_to(saved)
        with self.assertRaises(ValueError):m.seal(f.external/m.BOUNDARY,f.expected)
        self.assertEqual((saved/m.BOUNDARY).read_bytes(),m.encoded(f.boundary))
        f=self.fixture();f.external.rename(f.base/'saved');f.external.mkdir()
        (f.external/m.BOUNDARY).write_bytes(m.encoded(f.boundary))
        with patch.object(m,'clock_facts',return_value=f.facts),self.assertRaises(ValueError):
            m.adjudicate(f.external/m.PUBLICATION,f.expected)
        self.assertFalse((f.external/m.PUBLICATION).exists())
        f=self.fixture()
        with patch.object(m,'clock_facts',return_value=f.facts):
            self.assertTrue(m.adjudicate(f.external/m.PUBLICATION,f.expected))
        verdict=m.strict_json((f.external/m.PUBLICATION).read_bytes())
        self.assertEqual(verdict['schemaVersion'],2)
        self.assertEqual(verdict['inputPins']['boundary'],m.read_file(f.external/m.BOUNDARY)[1])
        self.assertEqual(verdict['inputPins']['external_root'],m.directory(f.external))
        self.assertEqual(verdict['inputPins']['artifact_root'],m.directory(f.root))
        verdict['identity']['run_id']=999
        (f.external/m.PUBLICATION).write_bytes(m.encoded(verdict))
        with patch.object(m,'clock_facts',return_value=f.facts),self.assertRaises(ValueError):
            m.adjudicate(f.external/m.FINAL,f.expected)
        self.assertFalse((f.external/m.FINAL).exists())
        f=self.fixture();f.original['trustedLifecycle']=False;f.original['outcomes']['PRODUCER']='UNKNOWN'
        (f.root/'held-owner-validation.json').write_bytes(m.encoded(f.original))
        with patch.object(m,'clock_facts',return_value=f.facts):
            self.assertFalse(m.adjudicate(f.external/m.PUBLICATION,f.expected))
        self.assertEqual(m.strict_json((f.external/m.PUBLICATION).read_bytes())['outcomes']['PRODUCER'],
                         'UNKNOWN')


if __name__=='__main__':unittest.main()
