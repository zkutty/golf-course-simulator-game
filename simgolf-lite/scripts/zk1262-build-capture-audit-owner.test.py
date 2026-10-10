"""ROOT-only actual source controls with synthetic Git/files/child/clock seams."""
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
OUT = Path(os.environ['ZK1262_HELD_TEST_OUT'])
OUT.mkdir(mode=0o700)


def pinned_load(variable, name):
    path = Path(os.environ[variable])
    raw = path.read_bytes()
    if len(raw)>32768 or hashlib.sha256(raw).hexdigest()!=os.environ[variable+'_SHA256']:
        raise RuntimeError('actual source binding failed: '+variable)
    spec = importlib.util.spec_from_file_location(name,path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


m = pinned_load('ZK1262_HELD_MODULE','held_actual_control_source')
hmodule = pinned_load('ZK1262_HELD_HELPER','held_actual_helper_source')
n = pinned_load('ZK1262_HELD_NORMALIZER','held_actual_normalizer_source')
BASE_H = dict(vars(hmodule))


def git(repo,*args):
    result = subprocess.run(['git','--no-optional-locks','-C',str(repo),*args],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,
        env={**os.environ,'GIT_AUTHOR_NAME':'held-control','GIT_COMMITTER_NAME':'held-control',
             'GIT_AUTHOR_EMAIL':'held@example.invalid','GIT_COMMITTER_EMAIL':'held@example.invalid'})
    if result.returncode or len(result.stdout)+len(result.stderr)>65536:
        raise RuntimeError('synthetic fixture Git refusal')
    return result.stdout


class FalseyError(Exception):
    cause = False
    def __bool__(self):
        return False


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(dir=OUT)
        self.base = Path(self.temp.name)
        self.target = self.base/'target'
        self.driver = self.base/'driver'
        self.root = self.base/'raw'
        for p in (self.target,self.driver,self.root):p.mkdir()
        self.audit = self.target/n.AUDIT
        self.audit.parent.mkdir(parents=True)
        self.baseline = b'{"baseline":"synthetic"}\n'
        self.generated = b'{"generated":"synthetic-build"}\n'
        self.audit.write_bytes(self.baseline)
        self.audit.chmod(0o644)
        self.protected = []
        self.pins = {}
        for i,pin in enumerate(n.registered_policy().protected):
            path = self.target/pin.path
            path.parent.mkdir(parents=True,exist_ok=True)
            data = ('synthetic protected '+str(i)+'\n').encode()
            path.write_bytes(data)
            path.chmod(0o644)
            self.protected.append(n.Pin(pin.path,len(data),n.sha(data)))
            self.pins[pin.path] = {'bytes':len(data),'sha256':n.sha(data)}
        (self.target/'.gitignore').write_text('simgolf-lite/dist/\n')
        git(self.target,'init','-q')
        git(self.target,'add','.')
        git(self.target,'commit','-qm','synthetic held baseline')
        self.head = git(self.target,'rev-parse','HEAD').strip().decode()
        self.policy = n.Policy(self.head,n.Pin(n.AUDIT,len(self.baseline),n.sha(self.baseline)),
                               tuple(self.protected))
        # Mutate only the freshly imported test helper globals; production CLI has no seam selector.
        vars(hmodule).clear()
        vars(hmodule).update(BASE_H)
        self.h = vars(hmodule)
        self.h['CANDIDATE'] = self.head
        self.h['PINS'] = self.pins
        self.h['IMPORTS'] = {}
        self.h['driver_guard'] = lambda *a: {}
        self.h['sdk_binding'] = lambda *a: {'syntheticSDK':True}
        self.tools = {}
        maps = []
        for i,relative in enumerate(BASE_H['TOOLS']):
            path = self.driver/relative
            path.parent.mkdir(parents=True,exist_ok=True)
            data = ('synthetic exact projection '+str(i)+'\n').encode()
            path.write_bytes(data)
            pin = {'bytes':len(data),'sha256':n.sha(data)}
            self.tools[relative] = pin
            maps.append({'target':relative,'before':pin,'after':pin,'replacements':[]})
        self.h['TOOLS'],self.h['MAPS'] = self.tools,maps
        self.h['ROLES'] = dict(BASE_H['ROLES'])
        self.env = {'CAPTURE_CANDIDATE_SHA':self.head,'CAPTURE_SOURCE_SHA':'2'*40,
            'GITHUB_SHA':'2'*40,'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1',
            'GITHUB_EVENT_NAME':'workflow_dispatch'}
        self.h['wx'](self.root/'phase-intent.json',{'roles':self.h['roles'](self.env),
            'firstFailurePresent':False,'firstFailure':None,'sourceQualified':True})
        self.bindings = {'synthetic-control-source':'source binding seam, never a CLI role'}
        self.owner = None
        self.sequence = []
        self.owner_ids = []
        self.fd_ids = []
        self.children = []
        self.mutate = None
        self.build_code = 0
        self.clock_value = 0.0
        self.virtual = False
        self.closed = 0

    def clock(self):
        if self.virtual:return self.clock_value
        return m.time.monotonic()

    def factory(self,target,evidence):
        self.owner = n.AuditOwner(target,evidence,self.policy)
        original = self.owner.close
        def close():
            self.closed += 1
            original()
        self.owner.close = close
        return self.owner

    def phase(self,name,owner):
        self.sequence.append(name)
        if owner is not None:
            self.owner_ids.append(id(owner))
            self.fd_ids.append(owner.files[n.AUDIT][0])
        if self.virtual:
            if name=='PREPARE':self.clock_value=800
            if name=='PRODUCER':self.clock_value=950
        if self.mutate is not None:self.mutate(name,owner)

    def runner(self,argv,cwd,env,deadline,seconds,grace,outputs,cap,**kw):
        self.children.append({'argv':list(argv),'env':dict(env),'seconds':seconds,'grace':grace,
                              'ceiling':kw['ceiling']})
        for path in outputs:
            with path.open('xb') as f:
                if argv==m.DISCOVERY:
                    f.write(b'e2e/zk1262-capture-phase-diagnostic.e2e.ts:1\nTotal: 1 test in 1 file\n')
        code = 0
        if argv==m.BUILD:
            self.audit.write_bytes(self.generated)
            code = self.build_code
        if argv[0]=='node':
            if self.virtual:self.clock_value=2810
        result = {'kind':'ACTUAL_CHILD_WAIT','argv':list(argv),'cwd':str(cwd),
                  'exitCode':code,'waited':True,'timeout':False,'durationSeconds':1,
                  'outputs':[]}
        if code:raise m.ChildFailure(result)
        return result

    def run(self):
        return m.run(self.h,self.driver,self.target,self.root,self.env,
            owner_factory=self.factory,runner=self.runner,phase_hook=self.phase,
            bindings=self.bindings,clock=self.clock)

    def validate(self):
        with patch.object(m,'source_bindings',return_value=self.bindings):
            return m.validate(self.h,self.driver,self.target,self.root,self.env)

    def rows(self):
        return [json.loads(line) for line in (self.root/m.JOURNAL).read_bytes().splitlines()]

    def rewrite(self,rows):
        (self.root/m.JOURNAL).write_bytes(b''.join(m.encoded(row) for row in rows))

    def close(self):
        if self.owner is not None:self.owner.close()
        self.temp.cleanup()


class Tests(unittest.TestCase):
    def setUp(self):self.fixtures=[]
    def tearDown(self):
        for f in reversed(self.fixtures):f.close()
    def fixture(self):
        f=Fixture();self.fixtures.append(f);return f

    def test_01_same_actual_normalizer_owner_fd_and_durable_phases(self):
        f=self.fixture();inode=f.audit.stat().st_ino
        self.assertTrue(f.run())
        self.assertEqual(f.sequence,list(m.PHASES))
        self.assertEqual(len(set(f.owner_ids)),1)
        self.assertEqual(len(set(f.fd_ids)),1)
        self.assertEqual(f.closed,1)
        self.assertEqual(f.audit.stat().st_ino,inode)
        self.assertEqual(f.audit.read_bytes(),f.baseline)
        self.assertEqual(f.owner.normalized,True)
        self.assertEqual((Path(str(f.root)+'-audit-owner')/'generated-audit.json').read_bytes(),f.generated)
        result=f.validate();self.assertTrue(result['trustedLifecycle'])
        self.assertEqual(set(result['outcomes'].values()),{'SUCCESS'})
        for rel in f.tools:self.assertFalse((f.target/rel).exists())
        self.assertEqual([c['argv'] for c in f.children],[m.BUILD,m.DISCOVERY,m.producer_argv(f.h,f.root)])
        for c in (f.children[0],f.children[2]):
            self.assertEqual(c['env']['GITHUB_SHA'],f.head)
            self.assertEqual(c['env']['VITE_COMMIT_SHA'],f.head)
            self.assertEqual(c['env']['ZK682_EXPECTED_COMMIT'],f.head)
        self.assertEqual((f.children[0]['seconds'],f.children[2]['seconds'],f.children[2]['grace']),(600,1920,60))

    def test_02_each_phase_fault_preserves_first_falsy_and_skips_later_work(self):
        for phase in m.PHASES:
            with self.subTest(phase=phase):
                f=self.fixture();token=FalseyError('first '+phase)
                def fault(name,owner):
                    if name==phase:raise token
                f.mutate=fault
                self.assertFalse(f.run())
                result=f.validate();self.assertFalse(result['trustedLifecycle'])
                self.assertEqual(result['outcomes'][phase],'FAILURE')
                self.assertEqual(result['terminal']['firstFailure']['phase'],phase)
                self.assertIs(result['terminal']['firstFailure']['error']['cause'],False)
                if phase not in ('CLEANUP','FINISH'):
                    index=m.PHASES.index(phase)
                    for p in m.PHASES[index+1:6]:self.assertEqual(result['outcomes'][p],'SKIPPED')
                if f.owner is not None:self.assertEqual(f.closed,1)

    def test_03_actual_failed_build_never_normalizes_or_produces(self):
        f=self.fixture();f.build_code=17
        self.assertFalse(f.run());r=f.validate()
        self.assertFalse(f.owner.spent)
        self.assertEqual(r['outcomes']['BUILD'],'FAILURE')
        self.assertEqual(r['outcomes']['NORMALIZE'],'SKIPPED')
        self.assertEqual(r['outcomes']['PRODUCER'],'SKIPPED')
        self.assertEqual(f.audit.read_bytes(),f.generated)
        self.assertEqual(len(f.children),1)
        self.assertEqual(r['terminal']['firstFailure']['error']['cause'],17)
        self.assertTrue(any(x['phase']=='FINISH' for x in r['terminal']['secondaryFailures']))

    def test_04_late_audit_mutation_fails_finish_without_second_restore(self):
        f=self.fixture()
        def mutate(name,owner):
            if name=='CLEANUP':f.audit.write_bytes(b'{"late":"must remain"}\n')
        f.mutate=mutate
        self.assertFalse(f.run());r=f.validate()
        self.assertEqual(r['outcomes']['FINISH'],'FAILURE')
        self.assertEqual(f.audit.read_bytes(),b'{"late":"must remain"}\n')
        self.assertTrue(f.owner.restoration_attempted)
        self.assertFalse((Path(str(f.root)+'-audit-owner')/'final.json').exists())

    def test_05_foreign_reporter_head_index_source_and_inode_are_preserved(self):
        for kind in ('reporter','head','index','source','inode','parent'):
            with self.subTest(kind=kind):
                f=self.fixture();saved=[]
                def mutate(name,owner):
                    if name!='CLEANUP':return
                    if kind=='reporter':
                        path=f.target/'foreign-reporter.json';path.write_bytes(b'FOREIGN');saved.append(path)
                    elif kind=='head':git(f.target,'commit','--allow-empty','-qm','foreign head')
                    elif kind=='index':
                        f.audit.write_bytes(b'{"foreign":"index"}\n');git(f.target,'add',n.AUDIT)
                    elif kind=='source':
                        path=f.target/f.protected[0].path;path.write_bytes(b'FOREIGN');saved.append(path)
                    else:
                        rel=next(iter(f.tools));path=f.target/rel
                        if kind=='inode':path.rename(path.with_name('saved-owned'));path.write_bytes(b'FOREIGN')
                        else:path.parent.rename(path.parent.with_name('saved-owned-parent'));path.parent.mkdir();path.write_bytes(b'FOREIGN')
                        saved.append(path)
                f.mutate=mutate
                self.assertFalse(f.run());r=f.validate();self.assertFalse(r['trustedLifecycle'])
                for p in saved:self.assertEqual(p.read_bytes(),b'FOREIGN')
                if kind in ('inode','parent'):self.assertEqual(r['outcomes']['CLEANUP'],'FAILURE')
                self.assertEqual(r['outcomes']['FINISH'],'FAILURE')

    def test_06_partial_prepare_retains_owned_identity_for_cleanup(self):
        f=self.fixture();rel=list(f.tools)[1];path=f.target/rel
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'FOREIGN')
        # Existing foreign path before prepare would be rejected by the strict guard.
        # Insert it after that guard, at the actual projection create boundary.
        path.unlink();original=os.open;inserted=False
        def opening(p,*a,**kw):
            nonlocal inserted
            if p==Path(rel).name and kw.get('dir_fd') is not None and not inserted:
                inserted=True;path.write_bytes(b'FOREIGN')
            return original(p,*a,**kw)
        with patch.object(m.os,'open',side_effect=opening):self.assertFalse(f.run())
        self.assertEqual(path.read_bytes(),b'FOREIGN')
        self.assertFalse((f.target/list(f.tools)[0]).exists())
        self.assertEqual(f.validate()['outcomes']['PREPARE'],'FAILURE')

    def test_07_normalizer_preservation_failure_and_first_cause(self):
        f=self.fixture();token=FalseyError('preservation first')
        def mutate(name,owner):
            if name=='NORMALIZE':
                owner.phase_hook=lambda *_:(_ for _ in ()).throw(token)
        f.mutate=mutate
        self.assertFalse(f.run())
        self.assertIs(f.owner.first_error,token)
        self.assertEqual(f.audit.read_bytes(),f.generated)
        r=f.validate();self.assertEqual(r['outcomes']['PRODUCER'],'SKIPPED')
        self.assertEqual(r['terminal']['firstFailure']['phase'],'NORMALIZE')

    def test_08_absolute_parent_remaining_prevents_cleanup_reset(self):
        clock=[100.0];d=m.Deadline(lambda:clock[0]);clock[0]=2910.0
        self.assertEqual(d.cap(60),10)
        self.assertEqual(d.cap(1980),10)
        clock[0]=2920.0
        with self.assertRaises(ValueError):d.cap(60)
        f=self.fixture();clock[0]=100.0;d=m.Deadline(lambda:clock[0])
        p=m.ProjectionOwner(f.h,f.driver,f.target,d);p.project()
        clock[0]=2910.0
        self.assertEqual(d.cap(60),10)
        self.assertEqual(len(p.cleanup()['removed']),4)
        p.close()

    def test_09_journal_negative_controls_and_unknown_started(self):
        for kind in ('duplicate','duplicate-key','old-role','hash','path','inode','truncate','oversize','fabricated','first-cause'):
            with self.subTest(kind=kind):
                f=self.fixture();self.assertTrue(f.run());rows=f.rows()
                if kind=='duplicate':rows[2]['sequence']=1
                elif kind=='old-role':rows[0]['roles']['run_id']=124
                elif kind=='hash':rows[0]['bindings']={'wrong':'hash'}
                elif kind=='path':rows[0]['target']=str(f.base/'foreign')
                elif kind=='inode':rows[0]['journalIdentity'][1]+=1
                elif kind=='fabricated':
                    rows[2]['result']['waited']=False
                elif kind=='first-cause':
                    rows[2]['exit']=1;rows[2]['causePresent']=True;rows[2]['cause']={'cause':False}
                    rows[-1]['firstFailurePresent']=True;rows[-1]['firstFailure']={'phase':'BUILD','error':{'cause':0}}
                f.rewrite(rows)
                if kind=='duplicate-key':
                    raw=(f.root/m.JOURNAL).read_bytes().replace(b'"schemaVersion":1',b'"schemaVersion":1,"schemaVersion":1',1)
                    (f.root/m.JOURNAL).write_bytes(raw)
                if kind=='truncate':(f.root/m.JOURNAL).write_bytes((f.root/m.JOURNAL).read_bytes()[:-1])
                elif kind=='oversize':(f.root/m.JOURNAL).write_bytes(b'x'*32769)
                with self.assertRaises((ValueError,OSError)):f.validate()
        f=self.fixture();self.assertTrue(f.run());rows=f.rows();f.rewrite(rows[:2])
        result=f.validate();self.assertFalse(result['trustedLifecycle'])
        self.assertEqual(result['outcomes']['BUILD'],'UNKNOWN')
        self.assertEqual(result['outcomes']['NORMALIZE'],'SKIPPED')

    def test_10_journal_collision_and_byte_inode_drift_preserve_foreign(self):
        f=self.fixture();p=f.root/m.JOURNAL;p.write_bytes(b'FOREIGN')
        with self.assertRaises(FileExistsError):f.run()
        self.assertEqual(p.read_bytes(),b'FOREIGN')
        f=self.fixture()
        def mutate(name,owner):
            if name=='NORMALIZE':
                p=f.root/m.JOURNAL;p.rename(f.root/'saved-journal');p.write_bytes(b'FOREIGN')
        f.mutate=mutate
        self.assertFalse(f.run());self.assertEqual((f.root/m.JOURNAL).read_bytes(),b'FOREIGN')

    def test_11_actual_child_output_cap_and_timeout_receipt(self):
        # Tiny owned synthetic child only; never original build or renderer workload.
        f=self.fixture();d=m.Deadline()
        receipt=m.child([sys.executable,'-c','print("owned synthetic child")'],f.base,os.environ,
            d,2,1,[f.base/'child-out',f.base/'child-err'],32768)
        self.assertTrue(receipt['waited']);self.assertEqual(receipt['exitCode'],0)
        with self.assertRaises(ValueError):
            m.child([sys.executable,'-c','print("x"*1000)'],f.base,os.environ,m.Deadline(),
                2,1,[f.base/'cap-out',f.base/'cap-err'],100)
        with self.assertRaises(m.ChildFailure) as caught:
            m.child([sys.executable,'-c','import time;time.sleep(5)'],f.base,os.environ,
                m.Deadline(),.1,.2,[f.base/'timeout-out',f.base/'timeout-err'],32768)
        self.assertTrue(caught.exception.receipt['timeout'])

    def test_12_finalize_maps_validated_actual_phases_and_neutral_refusal(self):
        for kind in ('success','build-fail','invalid'):
            f=self.fixture()
            if kind=='build-fail':f.build_code=17
            f.run()
            if kind=='invalid':(f.root/m.JOURNAL).write_bytes(b'FOREIGN')
            captured={}
            def finalize(driver,target,root,env):
                captured.update(env)
                state=f.h['read_state'](root)
                captured['state']=state
                return not state['firstFailurePresent']
            f.h['finalize']=finalize
            with patch.object(m,'source_bindings',return_value=f.bindings):
                actual=m.finalize(f.h,f.driver,f.target,f.root,{**f.env,'OUTCOME_HELD_OWNER':'success'})
            self.assertEqual(actual,kind=='success')
            if kind=='build-fail':
                self.assertEqual(captured['OUTCOME_BUILD'],'failure')
                self.assertEqual(captured['OUTCOME_PRODUCER'],'skipped')
                self.assertEqual(captured['state']['firstFailure']['error']['cause'],17)
            if kind=='invalid':self.assertEqual(captured['OUTCOME_BUILD'],'UNKNOWN')
            self.assertFalse((json.loads((f.root/'held-owner-validation.json').read_bytes())).get('trustedLifecycle') is True and kind!='success')

    def test_13_full_inverses_minimal_helper_and_workflow_budgets(self):
        packet=Path(os.environ['ZK1262_HELD_PACKET'])
        helper=(packet/'simgolf-lite/scripts/zk1262-capture-phase-driver.py').read_bytes()
        inverse=(packet/'full-inverse/simgolf-lite/scripts/zk1262-capture-phase-driver.py').read_bytes()
        before=b'else:return 0 if finalize(driver,target,root,os.environ) else 1'
        after=b"else:return 0 if __import__('zk1262-build-capture-audit-owner').finalize(globals(),driver,target,root,os.environ) else 1"
        self.assertEqual(helper.count(after),1);self.assertEqual(helper.replace(after,before,1),inverse)
        self.assertEqual(hashlib.sha256(inverse).hexdigest(),'4ec0ec471aad7c1ba35a83ebc53eb36d6504639484cea1b26df9f5ef12f7d62f')
        self.assertLessEqual(len(helper),32768)
        workflow=(packet/'.github/workflows/zk1262-capture-phase.yml').read_text()
        self.assertIn('timeout-minutes: 75',workflow);self.assertIn('timeout-minutes: 48',workflow)
        self.assertIn('timeout --signal=TERM --kill-after=60s 2820s python3',workflow)
        self.assertNotIn('OUTCOME_BUILD: ${{ steps.held_owner.outcome }}',workflow)
        self.assertEqual(600+120+1980+60+30,2790)
        self.assertEqual(2+2+2+1+10+5+48+2+2+1,75)
        old=(packet/'full-inverse/.github/workflows/zk1262-capture-phase.yml').read_bytes()
        self.assertEqual(hashlib.sha256(old).hexdigest(),'bf78700485cd57fab18848babd231f73b6e61364e77706377006d7a990053ac7')


    def test_14_late_phase_completion_is_unknown_never_trusted(self):
        for phase in ('BUILD','PRODUCER','CLEANUP','FINISH'):
            with self.subTest(phase=phase):
                f=self.fixture();self.assertTrue(f.run());rows=f.rows()
                entered=next(x for x in rows if x.get('phase')==phase and x['kind']=='ENTERED')
                index=next(i for i,x in enumerate(rows) if x.get('phase')==phase and x['kind']=='COMPLETED')
                delta=entered['deadline']+.01-rows[index]['at']
                if phase=='BUILD':
                    rows=rows[:index+1]+[rows[-1]]
                    rows[-2]['at']=entered['deadline']+.01
                    rows[-1]['at']=rows[-2]['at']+.01
                else:
                    for row in rows[index:]:
                        row['at']+=delta
                        if 'ceiling' in row and row['ceiling'] is not None:row['ceiling']+=delta
                        if 'deadline' in row:
                            term=rows[0]['parentTermDeadline']
                            if 'allocation' in row:
                                row['deadline']=min(term,row['at']+row['allocation'],
                                    row['ceiling'] if row['ceiling'] is not None else term)
                            else:row['deadline']+=delta
                for i,row in enumerate(rows):row['sequence']=i
                f.rewrite(rows);result=f.validate()
                self.assertTrue(result['valid'])
                self.assertEqual(result['outcomes'][phase],'UNKNOWN')
                self.assertFalse(result['trustedLifecycle'])

    def test_15_terminal_grace_and_parent_late_never_trusted(self):
        for offset in (0.01,60.0,60.01):
            with self.subTest(offset=offset):
                f=self.fixture();self.assertTrue(f.run());rows=f.rows()
                rows[-1]['at']=rows[0]['parentTermDeadline']+offset
                f.rewrite(rows)
                if offset>60:
                    with self.assertRaises(ValueError):f.validate()
                else:
                    result=f.validate();self.assertFalse(result['trustedLifecycle'])
                    self.assertEqual(result['outcomes']['FINISH'],'UNKNOWN')
        f=self.fixture();self.assertTrue(f.run());rows=f.rows()
        index=next(i for i,x in enumerate(rows) if x.get('phase')=='PRODUCER' and x['kind']=='COMPLETED')
        rows=rows[:index+1]+[rows[-1]]
        rows[-2]['at']=rows[0]['parentTermDeadline']+.01
        rows[-1]['at']=rows[-2]['at']+.01
        for i,row in enumerate(rows):row['sequence']=i
        f.rewrite(rows);result=f.validate()
        self.assertEqual(result['outcomes']['PRODUCER'],'UNKNOWN')
        self.assertEqual(result['outcomes']['CLEANUP'],'SKIPPED')
        self.assertFalse(result['trustedLifecycle'])

    def test_16_first_original_captured_before_hostile_formatting(self):
        for prior in (False,True):
            with self.subTest(prior=prior):
                failure=m.Failure();first=FalseyError('prior falsy')
                if prior:failure.record('BUILD',first)
                observations=[];access=[]
                class HostileError(Exception):
                    def __bool__(self):return False
                    def __str__(self):
                        observations.append((failure.present,failure.original is (first if prior else self)))
                        raise RuntimeError('hostile string conversion')
                    @property
                    def cause(self):
                        access.append(True)
                        raise RuntimeError('hostile cause accessor')
                token=HostileError('primary')
                failure.record('NORMALIZE',token)
                self.assertEqual(observations,[(True,True)])
                self.assertEqual(access,[])
                self.assertIs(failure.original,first if prior else token)
                value=(failure.secondary[-1] if prior else failure.first)['error']
                self.assertEqual(value['message'],'UNKNOWN')
                self.assertIsNone(value['cause'])
                self.assertEqual(set(value['formatErrors']),{'message','cause'})
                if prior:self.assertIs(failure.first['error']['cause'],False)
                self.assertLessEqual(len(m.encoded(value)),32768)

    def test_17_hostile_primary_keeps_journal_cleanup_finish_and_close(self):
        for phase in ('NORMALIZE','PRODUCER','CLEANUP','FINISH'):
            with self.subTest(phase=phase):
                f=self.fixture();access=[]
                class HostileError(Exception):
                    def __bool__(self):return False
                    def __str__(self):raise RuntimeError('formatter secondary')
                    @property
                    def cause(self):
                        access.append(True);raise RuntimeError('accessor secondary')
                token=HostileError('exact primary')
                def mutate(name,owner):
                    if name==phase:raise token
                f.mutate=mutate
                self.assertFalse(f.run());self.assertEqual(f.closed,1)
                result=f.validate();self.assertFalse(result['trustedLifecycle'])
                self.assertEqual(result['outcomes'][phase],'FAILURE')
                self.assertEqual(result['terminal']['firstFailure']['phase'],phase)
                value=result['terminal']['firstFailure']['error']
                self.assertEqual(value['type'],'HostileError')
                self.assertEqual(set(value['formatErrors']),{'message','cause'})
                self.assertEqual(access,[])
                self.assertTrue(result['terminal']['ownerClosed'])
                self.assertIn('CLEANUP',f.sequence)
                self.assertIn('FINISH',f.sequence)


    def test_18_honest_effective_deadline_matches_shared_ceiling(self):
        f=self.fixture();tick=[100.0]
        def clock():
            tick[0]+=.001
            return tick[0]
        f.clock=clock
        self.assertTrue(f.run());result=f.validate()
        self.assertTrue(result['trustedLifecycle'])
        rows=f.rows();term=rows[0]['parentTermDeadline']
        entered={r['phase']:r for r in rows if r['kind']=='ENTERED'}
        limits=dict(zip(m.PHASES,(600,30,120,120,120,1980,60,30)))
        for phase,row in entered.items():
            self.assertGreater(row['allocation'],0)
            self.assertLessEqual(row['allocation'],limits[phase])
            self.assertEqual(row['deadline'],min(term,row['at']+row['allocation'],
                row['ceiling'] if row['ceiling'] is not None else term))
        shared=[entered[p] for p in ('PREPARE','DISCOVERY','READY')]
        self.assertEqual(len({r['ceiling'] for r in shared}),1)
        self.assertEqual(len({r['deadline'] for r in shared}),1)
        self.assertEqual(shared[0]['deadline'],shared[0]['ceiling'])
        self.assertLessEqual(shared[0]['ceiling']-shared[0]['at'],120)
        self.assertLess(entered['FINISH']['allocation'],30)

    def test_19_effective_deadline_forgery_refuses(self):
        for kind in ('deadline','allocation','ceiling','shared','over-limit'):
            with self.subTest(kind=kind):
                f=self.fixture();self.assertTrue(f.run());rows=f.rows()
                phase='BUILD' if kind in ('deadline','allocation','over-limit') else 'READY'
                row=next(r for r in rows if r.get('phase')==phase and r['kind']=='ENTERED')
                if kind=='deadline':row['deadline']-=.001
                elif kind=='allocation':row['allocation']-=1
                elif kind=='over-limit':row['allocation']+=1
                elif kind=='ceiling':row['ceiling']-=.001
                else:
                    row['ceiling']+=.001
                    row['deadline']=min(rows[0]['parentTermDeadline'],row['at']+row['allocation'],row['ceiling'])
                f.rewrite(rows)
                with self.assertRaises(ValueError):f.validate()


if __name__=='__main__':unittest.main(verbosity=2)
