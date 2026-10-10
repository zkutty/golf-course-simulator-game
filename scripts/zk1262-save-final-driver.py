"""Inert SAVE owner adapter; ROOT alone activates it under a later admission.
The seal CLI must run before GNU timeout --signal=TERM --kill-after=60 2820.
Never imports capture helper/owner/adjudicator/typed consumers. One exact AuditOwner.
"""
import argparse
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import re
import signal
import stat
import subprocess
import sys
import time

NORMALIZER_SHA = '75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'
DERIVATIVE_SHA = '5a78fd068355f9631de5cf85df886ae4ee3e6ae9251422c7e3bfe8876b1e0216'
ORIGINAL_SHA = 'c45b0cf36a725fbe4da0de4877cdac016e29c334f63f1a3b674edfb20bdd2a45'
COLLECTOR_SHA = '917c4dcc17cce4714dc20008fdd845d9948df1eecd2ffd53ada5f14bc998bf54'
DECLARATION_SHA = '68ac78feee2b9bc48b2ece2f9f9f78c89e2ad47f46a8bf8f28afde61a9ca45c6'
RUNNER_SHA = '43587e0f25cba83c3fe0f16884a91e291cf7bce7e813bd5c9a9805e038393647'
SPEC = 'e2e/zk1262-save-final-owner-diagnostic.e2e.ts'
MAP = ('simgolf-lite/'+SPEC,
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs',
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.d.mts',
 'simgolf-lite/scripts/zk1262-run-save-final-owner-diagnostic.mjs')
IMPORT = b'import { captureSaveFinalOwnerGraph } from "../scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs";\n'
CALL = b'  await captureSaveFinalOwnerGraph(cdp, { outputDirectory, candidateCommit: expectedCommit!, sampleCount: saveLoadSamples.length, saveReportErrors: saveLoadReport.errors });\n'
PROJECTED_IMPORT = IMPORT.replace(b'../scripts/save-owner-collector.mjs',b'../scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs')

TIMING_DELIVERY = b'  const timingCleanupPayload = `${JSON.stringify({\n    candidateCommit: expectedCommit,\n    command: "npm run test:stability",\n    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown" },\n    filter: "detail.devtools.track === Components \xe2\x9a\x9b; all entries of each name must match",\n    samples: timingCleanupSamples,\n  }, null, 2)}\\n`;\n  await writeFile(timingCleanupPath, timingCleanupPayload);\n  const timingDeliveryFs = await import("node:fs/promises");\n  const timingDeliveryRoot = process.env.COURSECRAFT_ZK682_STABILITY_DIR;\n  if (!timingDeliveryRoot || timingDeliveryRoot !== outputDirectory\n    || resolve(timingDeliveryRoot) !== timingDeliveryRoot\n    || await timingDeliveryFs.realpath(timingDeliveryRoot) !== timingDeliveryRoot\n    || !(await timingDeliveryFs.lstat(timingDeliveryRoot)).isDirectory()) {\n    throw new Error("SAVE timing delivery requires the declared canonical artifact root");\n  }\n  if (Buffer.byteLength(timingCleanupPayload, "utf8") > 65_536) {\n    throw new Error("SAVE timing delivery exceeds declared metadata role cap");\n  }\n  await writeFile(resolve(outputDirectory, "zk682-react-component-timing-cleanup.json"), timingCleanupPayload, { flag: "wx" });\n'
TIMING_ORIGINAL = b'  await writeFile(timingCleanupPath, `${JSON.stringify({\n    candidateCommit: expectedCommit,\n    command: "npm run test:stability",\n    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown" },\n    filter: "detail.devtools.track === Components \xe2\x9a\x9b; all entries of each name must match",\n    samples: timingCleanupSamples,\n  }, null, 2)}\\n`);\n'


def source_bytes(path,cap=65536):
    if str(Path(path).parent)!=os.path.realpath(Path(path).parent):raise RuntimeError('module canonical parent')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a=os.fstat(fd)
        if not stat.S_ISREG(a.st_mode) or a.st_nlink!=1 or a.st_size>cap:raise RuntimeError('module regular/cap')
        raw=os.pread(fd,cap+1,0);b=os.fstat(fd);located=Path(path).lstat()
        if (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)!=(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns):raise RuntimeError('module read drift')
        if len(raw)!=a.st_size or len(raw)>cap or (located.st_dev,located.st_ino)!=(a.st_dev,a.st_ino):raise RuntimeError('module incomplete/inode')
        return raw
    finally:os.close(fd)


def load_exact(path,pin,name):
    # Hash before execution; no network, no package import, no top-level capture donor.
    raw=source_bytes(path)
    if len(raw)!=pin['bytes'] or hashlib.sha256(raw).hexdigest()!=pin['sha256']:
        raise RuntimeError('module source pin: '+name)
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    try:exec(compile(raw,str(path),'exec'),module.__dict__)
    except BaseException:
        sys.modules.pop(name,None);raise
    return module


class FirstCause:
    def __init__(self):self.present=False;self.value=None;self.secondary=[]
    def record(self,value):
        if not self.present:self.present=True;self.value=value
        elif len(self.secondary)<16:self.secondary.append(value)
    def serial(self,value):
        if value is None or type(value) in (str,int,float,bool):return value
        return {'type':type(value).__name__,'message':str(value)[:1024]}
    def fields(self):
        return {'firstCausePresent':self.present,'firstCause':self.serial(self.value) if self.present else None,
                'secondary':[self.serial(x) for x in self.secondary]}


def projected_bytes(p,donors):
    # Complete inverses over actual extracted source; no measurement body rewrite.
    derivative,_=p.file_bytes(donors['producer'],65536)
    original,_=p.file_bytes(donors['originalProducer'],65536)
    collector,_=p.file_bytes(donors['collector'],65536)
    declaration,_=p.file_bytes(donors['declaration'],65536)
    runner,_=p.file_bytes(donors['runner'],65536)
    for raw,pin in ((derivative,DERIVATIVE_SHA),(original,ORIGINAL_SHA),(collector,COLLECTOR_SHA),
                    (declaration,DECLARATION_SHA),(runner,RUNNER_SHA)):
        p.require(p.digest(raw)==pin,'projection source donor')
    p.require(derivative.count(IMPORT)==1 and derivative.count(CALL)==1,'one import/await')
    p.require(derivative.count(TIMING_DELIVERY)==1,'one accepted timing delivery span')
    inverse=derivative.replace(IMPORT,b'',1).replace(CALL,b'',1).replace(TIMING_DELIVERY,TIMING_ORIGINAL,1)
    p.require(inverse==original,'complete producer inverse')
    after=derivative.split(CALL,1)[1]
    p.require(after.index(b'await page.keyboard.press("Digit3")')<after.index(b'longSessionSamples'),'SAVE capture before original later order')
    p.require(runner.count(b'e2e/zk682-stability.e2e.ts')==1,'one runner spec literal')
    producer=derivative.replace(IMPORT,PROJECTED_IMPORT,1)
    run=runner.replace(b'e2e/zk682-stability.e2e.ts',SPEC.encode(),1)
    p.require(run.replace(SPEC.encode(),b'e2e/zk682-stability.e2e.ts',1)==runner,'runner full inverse')
    return dict(zip(MAP,(producer,collector,declaration,run)))


class ProjectionOwner:
    """New SAVE four paths; only captured dev/ino and one new empty directory."""
    def __init__(self,p,target,check):
        self.p=p;self.target=Path(target);self.check=check;self.owned={};self.parents={};self.directory=None
    def project(self,blobs):
        p=self.p;directory=self.target/'simgolf-lite/scripts/zk1262-save-owner-diagnostic'
        p.canonical(directory.parent);self.check()
        os.mkdir(directory,0o700);self.directory=(directory,p.physical(directory))
        for relative in MAP:
            self.check();path=self.target/relative;p.canonical(path.parent)
            fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            self.parents[relative]=(fd,p.physical(path.parent),path.parent)
            pin=p.wx(path,blobs[relative],65536);self.owned[relative]=pin
        return {'created':len(self.owned),'inverse':True,'files':self.owned}
    def guard(self):
        for relative,pin in self.owned.items():
            self.check();_,actual=self.p.file_bytes(self.target/relative,65536)
            self.p.require(self.p.equal(actual,pin),'owned projection byte/inode drift')
            fd,expected,path=self.parents[relative]
            self.p.require(self.p.physical(path)==expected=={'dev':os.fstat(fd).st_dev,'ino':os.fstat(fd).st_ino},'owned parent drift')
    def cleanup(self):
        p=self.p;removed=[];errors=[]
        for relative,pin in self.owned.items():
            try:
                self.check();fd,expected,parent=self.parents[relative]
                p.require(p.physical(parent)==expected=={'dev':os.fstat(fd).st_dev,'ino':os.fstat(fd).st_ino},'cleanup parent drift')
                s=os.stat(Path(relative).name,dir_fd=fd,follow_symlinks=False)
                p.require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and {'dev':s.st_dev,'ino':s.st_ino}==
                          {k:pin[k] for k in ('dev','ino')},'foreign projection preserved')
                p.require(p.equal(p.stream_pin(self.target/relative,65536),pin),'foreign modified projection preserved')
                os.unlink(Path(relative).name,dir_fd=fd);os.fsync(fd);removed.append(relative)
            except BaseException as error:errors.append(str(error)[:512])
        directory_removed=False
        if self.directory:
            try:
                self.check();path,expected=self.directory
                p.require(p.physical(path)==expected and not list(path.iterdir()),'foreign/nonempty owned directory preserved')
                os.rmdir(path);directory_removed=True
            except BaseException as error:errors.append(str(error)[:512])
        return {'inverse':True,'created':len(self.owned),'removed':len(removed),
                'ownedEmptyDirectoryRemoved':directory_removed,'errors':errors}
    def close(self):
        for fd,_,_ in self.parents.values():os.close(fd)
        self.parents.clear()


def child(p,argv,cwd,env,ceiling,term_seconds,grace,stdout_path,stderr_path,budget=None):
    """Actually waits only the launched outer process. No inferred nested closure."""
    start=time.monotonic();cause=FirstCause();process=None;streams=[];selector=selectors.DefaultSelector()
    if budget is None:budget={'bytes':0}
    receipt={'argv':list(argv),'cwd':str(cwd),'entered':False,'waited':False,'completed':False,'exitCode':None,'signal':None,
             'timeoutPresent':False,'startedMonotonic':start,'endedMonotonic':start,
             'firstCausePresent':False,'firstCause':None,'secondary':[]}
    end=min(ceiling,start+term_seconds);kill_end=min(ceiling,end+grace);sent=False;charged=0
    prefixes=[bytearray(),bytearray()];hashes=[hashlib.sha256(),hashlib.sha256()];counts=[0,0]
    try:
        p.require(start<end,'child launch deadline')
        for path in (stdout_path,stderr_path):
            fd=None if path is None else os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            streams.append(fd)
        process=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        receipt['entered']=True
        selector.register(process.stdout,selectors.EVENT_READ,0);selector.register(process.stderr,selectors.EVENT_READ,1)
        while selector.get_map() or process.poll() is None:
            now=time.monotonic()
            if now>=end and not sent:
                receipt['timeoutPresent']=True;cause.record('OUTER_TIMEOUT');sent=True
                os.killpg(process.pid,signal.SIGTERM)
            if now>=kill_end and process.poll() is None:os.killpg(process.pid,signal.SIGKILL)
            if now>kill_end+2:raise RuntimeError('outer wait/pipe closure deadline')
            for key,_ in selector.select(0.05):
                block=os.read(key.fileobj.fileno(),4096)
                if not block:selector.unregister(key.fileobj);continue
                charged+=len(block);budget['bytes']+=len(block)
                p.require(budget['bytes']<=262144,'aggregate stdout/stderr cap')
                index=key.data;hashes[index].update(block);counts[index]+=len(block)
                prefixes[index].extend(block[:max(0,4096-len(prefixes[index]))])
                if streams[index] is not None:
                    offset=0
                    while offset<len(block):
                        n=os.write(streams[index],block[offset:]);p.require(n>0,'log write');offset+=n
        code=process.wait(timeout=max(0.001,kill_end+2-time.monotonic()));receipt['waited']=True
        receipt['completed']=True
        if code<0:receipt['signal']=-code
        else:receipt['exitCode']=code
        if code!=0:cause.record({'outerExitCode':receipt['exitCode'],'outerSignal':receipt['signal']})
    except BaseException as error:cause.record(error)
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            try:
                code=process.wait(timeout=2);receipt['waited']=True
                if receipt['exitCode'] is None and receipt['signal'] is None:
                    if code<0:receipt['signal']=-code
                    else:receipt['exitCode']=code
            except BaseException as error:cause.record(error)
            for pipe in (process.stdout,process.stderr):
                try:pipe.close()
                except BaseException as error:cause.record(error)
        for fd in streams:
            if fd is None:continue
            try:os.fsync(fd);os.close(fd)
            except BaseException as error:cause.record(error)
        receipt.update(cause.fields(),endedMonotonic=time.monotonic(),
          output=[{'bytes':counts[i],'sha256':hashes[i].hexdigest(),
                   'prefix':bytes(prefixes[i]).decode('utf8','replace')} for i in range(2)])
        if receipt['endedMonotonic']>ceiling:
            if not cause.present:cause.record('LATE_OUTER_COMPLETION')
            receipt['completed']=False;receipt.update(cause.fields())
    return receipt


def neutral(p,ctx,r):
    p.require(r['entered'] is False or ('argv' in r and 'cwd' in r),'actual launched argv/cwd required')
    return {'schema':1,'kind':'SAVE_ACTUAL_OUTER_RUNNER_WAIT_V1','identity':ctx['identity'],
      'outerRunnerArgv':r['argv'] if 'argv' in r else p.commands(ctx)['PRODUCER'],'sourceQualifiedChildArgv':p.CHILD,
      'cwdRole':r['cwd'] if 'cwd' in r else ctx['targetRoot']+'/simgolf-lite','outerEntered':r['entered'],'outerWaited':r['waited'],
      'outerCompleted':r['completed'],'outerExitCode':r['exitCode'],'outerSignal':r['signal'],
      'timeoutPresent':r['timeoutPresent'],'firstCausePresent':r['firstCausePresent'],'firstCause':r['firstCause'],
      'startedMonotonic':r['startedMonotonic'],'endedMonotonic':r['endedMonotonic'],
      'observedClosureQualification':'OUTER_NODE_WAIT_ONLY_NESTED_CHILD_UNKNOWN'}


def audit_evidence(p,root):
    root=p.canonical(root);before=p.physical(root);out={};total=0
    for path in root.iterdir():
        p.require(path.name in p.AUDITS,'foreign AuditOwner evidence')
        raw,pin=p.file_bytes(path,65536 if path.name.endswith('audit.json') else p.CAP)
        p.strict_json(raw,65536);total+=len(raw);p.require(total<=262144,'audit aggregate')
        out[path.name]=pin
    p.require(p.physical(root)==before,'audit directory drift')
    return {'root':str(root),'rootIdentity':before,'files':out}


def source_guard(p,ctx,normalizer,projection=None):
    repo=ctx['driverRoot'];target=ctx['targetRoot'];driver=ctx['identity']['driver']
    p.require(normalizer.git(repo,'rev-parse','--verify','HEAD').strip().decode()==driver,'driver HEAD')
    p.require(normalizer.git(target,'rev-parse','--verify','HEAD').strip().decode()==p.CANDIDATE,'candidate HEAD')
    for relative,pin in ctx['sourcePins'].items():
        raw,actual=p.file_bytes(Path(repo)/relative,65536)
        p.require({k:actual[k] for k in ('bytes','sha256')}==pin,'ROOT driver source bytes')
        committed=normalizer.git(repo,'show',driver+':'+relative)
        p.require(committed==raw,'ROOT driver Git blob bytes')
    if projection:projection.guard()
    return {'ok':True,'identity':ctx['identity'],'sourcePins':ctx['sourcePins']}


def live_boundary(p,ctx):
    root=Path(ctx['artifactRoot']);external=Path(str(root)+'-external')
    raw,pin=p.file_bytes(external/p.EXTERNAL[0],p.CAP);marker=p.strict_json(raw)
    facts={'boundary':pin,'bootId':p.boot(),'rootIdentity':p.physical(root),
      'externalIdentity':p.physical(external),'parentIdentity':p.physical(root.parent),'prelaunchStart':marker['start']}
    p.require(p.equal(pin,ctx['prelaunchBoundaryPin']),'ROOT bound prelaunch full pin')
    p.boundary(marker,ctx,facts,pin);return marker,pin,facts


def publish(p,ctx,final=False):
    # Mandatory caller must propagate any exception/nonzero. Exactly wx role.
    marker,bpin,facts=live_boundary(p,ctx);root=Path(ctx['artifactRoot']);inputs={}
    jraw,inputs['phase-journal.json']=p.file_bytes(root/'phase-journal.json',p.CAP)
    rraw,inputs['save-actual-command-receipt.json']=p.file_bytes(root/'save-actual-command-receipt.json',p.CAP)
    journal=p.strict_json(jraw);receipt=p.strict_json(rraw)
    role=p.EXTERNAL[2 if final else 1]
    result=p.adjudicate(journal,receipt,marker,ctx,facts,bpin,time.monotonic(),inputs,role)
    p.wx(Path(ctx['artifactRoot']+'-external')/role,result)
    return result


def run(p,ctx,normalizer):
    """Future hosted owner entry: no default admission, no capture aliases."""
    p.identity(ctx)
    p.require(ctx.get('runtimeAdmission')=='ROOT_SEPARATELY_REGISTERED_SAVE_ONCE'
       and type(ctx.get('admissionSHA256')) is str and len(ctx['admissionSHA256'])==64,'separate future ROOT admission')
    marker,bpin,facts=live_boundary(p,ctx);root=Path(ctx['artifactRoot']);cwd=ctx['targetRoot']+'/simgolf-lite'
    start=marker['start'];term=start+p.TERM;cause=FirstCause();owner=None;prep=None;normal_elapsed=0;budget={'bytes':0}
    audit={'oneOwner':False,'beforeBuild':False,'normalizeOnce':False,'buildSucceeded':False,'normalized':False,'strictFinish':False}
    summary={'inverse':False,'created':0,'removed':0,'ownedEmptyDirectoryRemoved':False}
    discovered={'tests':0,'files':[]};sdk=False;sources=False;closed=False;receipt=None
    journal={'schema':1,'identity':ctx['identity'],'sourcePins':ctx['sourcePins'],'commands':p.commands(ctx),'phases':[],'terminal':None}
    def check(ceiling=term):p.require(time.monotonic()<min(term,ceiling),'owner absolute deadline')
    projection=ProjectionOwner(p,ctx['targetRoot'],lambda:check(prep or term))
    def phase(name,fn):
        nonlocal prep,normal_elapsed
        entry=time.monotonic();allocation=p.ALLOC[name]
        if name in ('NORMALIZE','FINISH'):allocation=max(0,30-normal_elapsed)
        if name=='PREPARE':prep=min(term,entry+120)
        ceiling=min(term,entry+allocation)
        if name in ('PREPARE','DISCOVERY','READY'):ceiling=prep
        row={'phase':name,'entry':entry,'exit':entry,'allocation':allocation,'ceiling':ceiling,'outcome':'UNKNOWN','result':None}
        journal['phases'].append(row)
        try:
            check(ceiling);row['result']=fn(ceiling);check(ceiling);row['outcome']='PASS';return row['result']
        except BaseException as error:
            cause.record(error);row['result']={'failure':cause.serial(error)};row['outcome']='FAIL';raise
        finally:
            row['exit']=time.monotonic()
            if name in ('NORMALIZE','FINISH'):normal_elapsed+=row['exit']-entry
    def skipped(name):journal['phases'].append({'phase':name,'entry':None,'exit':None,'allocation':p.ALLOC[name],
                 'ceiling':None,'outcome':'SKIPPED','result':None})
    env=dict(os.environ);env.update(ZK682_EXPECTED_COMMIT=p.CANDIDATE,VITE_COMMIT_SHA=p.CANDIDATE,
      COURSECRAFT_ZK682_STABILITY_DIR=str(root),ZK1262_OWNER_CAPTURE_ADMISSION='ROOT_REGISTERED_ONCE_B7_SOURCE1',
      ZK1262_OWNER_LINK_PUBLICATION_RECEIPT_SHA256='46b63243a78085ead78720766f1c5031ba0b75acb8bec82865f73d17916544f9')
    try:
        p.require(not os.environ.get('NODE_OPTIONS') and not os.environ.get('NODE_PATH'),'bound Node runtime hooks must be absent')
        p.require(type(ctx.get('environmentExpected')) is dict and set(ctx['environmentExpected'])=={'PATH','PLAYWRIGHT_BROWSERS_PATH'},'ROOT default toolchain/environment provenance required')
        for key,value in ctx['environmentExpected'].items():
            p.require(os.environ.get(key,'')==value,'actual caller environment drift: '+key)
        check();p.wx(root/'source-context.json',{'identity':ctx['identity'],'sourcePins':ctx['sourcePins']})
        p.wx(root/'phase-intent.json',{'phases':list(p.PHASES),'commands':p.commands(ctx),'policy':p.POLICY})
        sources=source_guard(p,ctx,normalizer)['ok'];p.wx(root/'source-before.json',{'ok':sources})
        p.require({k:v for k,v in p.stream_pin(ctx['node'],ctx['nodePin']['bytes']).items() if k in ('bytes','sha256')}==ctx['nodePin'],'actual Node source')
        owner=normalizer.AuditOwner(ctx['targetRoot'],str(root)+'-audit-owner',normalizer.registered_policy())
        audit.update(oneOwner=True,beforeBuild=True)
        def build(ceiling):
            r=child(p,p.commands(ctx)['BUILD'],cwd,env,ceiling,600,0,None,None,budget)
            p.require(r['entered'] and r['waited'] and r['completed'] and r['exitCode']==0 and not r['firstCausePresent'],'real successful build')
            audit['buildSucceeded']=True
            return {'exitCode':r['exitCode'],'actualOuterWait':True,'boundedOutput':r['output']}
        phase('BUILD',build)
        def normalize(ceiling):
            value=owner.normalize(True);audit.update(normalizeOnce=True,normalized=value.get('producerEligible') is True)
            p.require(audit['normalized'],'normalize eligibility');return value
        phase('NORMALIZE',normalize)
        def prepare(ceiling):
            nonlocal summary,sdk
            projection.check=lambda:check(ceiling)
            blobs=projected_bytes(p,ctx['projectionDonors'])
            for relative,raw in blobs.items():p.require(ctx['sourcePins'][relative]=={'bytes':len(raw),'sha256':p.digest(raw)},'four admitted source blobs')
            summary.update(projection.project(blobs));p.wx(root/'projection-proof.json',summary)
            proof=source_guard(p,ctx,normalizer,projection);p.wx(root/'source-preproducer.json',proof)
            p.require(ctx['sdkExpected']['playwrightVersion']=='1.61.1' and ctx['sdkExpected']['revision']=='1228','fixed default SDK')
            observed=[]
            for path,pin in ctx['sdkFiles'].items():
                actual=p.stream_pin(path,pin['bytes']);p.require({k:actual[k] for k in ('bytes','sha256')}==pin,'default SDK installed byte binding');observed.append({'path':path,**actual})
            p.require(len(observed)>=3,'SDK package/registry/binary binding')
            sdk=True;p.wx(root/'sdk-binding.json',{'expected':ctx['sdkExpected'],'files':observed});return {'fourProjections':True,'sdk':True}
        phase('PREPARE',prepare)
        def discovery(ceiling):
            nonlocal discovered
            r=child(p,p.commands(ctx)['DISCOVERY'],cwd,env,ceiling,120,0,root/'discovery.log',None,budget)
            p.require(r['exitCode']==0 and not r['firstCausePresent'] and r['completed'],'discovery completion')
            raw,_=p.file_bytes(root/'discovery.log',262144);text=raw.decode('utf8','strict')
            listed=re.findall(r'^\s*\[chromium\]\s+›\s+([^\s:]+):[0-9]+:[0-9]+\s+›.*$',text,re.MULTILINE)
            p.require(text.count('Total: 1 test in 1 file')==1 and len(listed)==1
              and listed[0] in (SPEC,Path(SPEC).name),'exact discovery list/path resolution')
            projection.guard();discovered={'tests':1,'files':[cwd+'/'+SPEC]};return discovered
        phase('DISCOVERY',discovery)
        def ready(ceiling):
            projection.guard();source_guard(p,ctx,normalizer,projection)
            p.wx(root/'projection-before-producer.json',{'files':projection.owned,'ok':True});return {'ready':True}
        phase('READY',ready)
        def producer(ceiling):
            nonlocal receipt
            r=child(p,p.commands(ctx)['PRODUCER'],cwd,env,ceiling,1920,60,root/'producer.stdout.log',root/'producer.stderr.log',budget)
            receipt=neutral(p,ctx,r);p.wx(root/'producer-exit.json',{'exitCode':r['exitCode'],'signal':r['signal'],'firstCausePresent':r['firstCausePresent'],'firstCause':r['firstCause']})
            p.wx(root/'producer-status.json',r)
            if r['firstCausePresent']:cause.record(r['firstCause'])
            p.require(p.receipt_validate(receipt,ctx,ceiling)=='RUNNER_COMPLETED_ONLY','actual outer producer qualification')
            return {'runnerCompletedOnly':True,'nestedChildClosure':'UNKNOWN'}
        phase('PRODUCER',producer)
    except BaseException as error:cause.record(error)
    finally:
        reached={r['phase'] for r in journal['phases']}
        for name in p.PHASES[:6]:
            if name not in reached:skipped(name)
        try:
            projection.check=lambda:check(min(term,time.monotonic()+60))
            def cleanup(ceiling):
                nonlocal summary
                projection.check=lambda:check(ceiling);result=projection.cleanup();summary.update(result)
                p.require(not result['errors'],'own-only cleanup failures');return result
            phase('CLEANUP',cleanup)
        except BaseException as error:cause.record(error)
        try:
            if owner:
                def finish(ceiling):
                    value=owner.finish();audit['strictFinish']=value.get('finalSourceEligible') is True
                    p.require(audit['strictFinish'],'strict finish eligibility');return value
                phase('FINISH',finish)
            else:skipped('FINISH')
        except BaseException as error:cause.record(error)
        try:
            source_guard(p,ctx,normalizer);sources=True;p.wx(root/'source-after.json',{'ok':True})
        except BaseException as error:sources=False;cause.record(error)
        try:projection.close()
        except BaseException as error:cause.record(error)
        if owner:
            descriptors=[r[0] for r in owner.files.values()]+[r[0] for r in owner.dirs.values()]
            try:audit['evidence']=audit_evidence(p,Path(str(root)+'-audit-owner'))
            except BaseException as error:cause.record(error)
            finally:
                try:owner.close()
                except BaseException as error:cause.record(error)
            closed=True
            for fd in descriptors:
                try:os.fstat(fd);closed=False
                except OSError as error:
                    if error.errno!=errno.EBADF:closed=False
            if not closed:cause.record('actual retained owner descriptor closure failed')
        if receipt is None:
            receipt=neutral(p,ctx,{'entered':False,'waited':False,'completed':False,'exitCode':None,'signal':None,
              'timeoutPresent':False,'firstCausePresent':cause.present,'firstCause':cause.fields()['firstCause'],
              'startedMonotonic':max(start,time.monotonic()),'endedMonotonic':max(start,time.monotonic())})
        journal['phases']=sorted(journal['phases'],key=lambda r:p.PHASES.index(r['phase']))
        journal['terminal']={**cause.fields(),'audit':audit,'projection':summary,'discovery':discovered,
                             'sdk':sdk,'sources':sources,'descriptorsClosed':closed}
        publication_errors=[]
        for path,value in [('save-actual-command-receipt.json',receipt),('phase-journal.json',journal),
                           ('setup-status.json',{'failed':cause.present,**cause.fields()})]:
            try:p.wx(root/path,value)
            except BaseException as error:publication_errors.append(str(error)[:512])
        try:
            p.wx(root/'save-owner-validation.json',p.lifecycle(journal,receipt,ctx))
        except BaseException as error:
            publication_errors.append(str(error)[:512])
            try:p.wx(root/'save-owner-validation.json',{'eligible':False,'error':str(error)[:512]})
            except BaseException as secondary:publication_errors.append(str(secondary)[:512])
        try:p.wx(root/'inventory.json',p.inventory(root))
        except BaseException as error:publication_errors.append(str(error)[:512])
        return {'ownerEligible':not cause.present and not publication_errors,'firstCause':cause.fields(),
                'publicationErrors':publication_errors,'runtimeQualification':'Operational owner only; both mandatory external CLI verdicts and typed composition still required; nested/native closure UNKNOWN'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['run','publish','final'])
    parser.add_argument('--context',required=True);parser.add_argument('--context-sha256',required=True)
    parser.add_argument('--phase',required=True);parser.add_argument('--phase-sha256',required=True)
    args=parser.parse_args();raw=source_bytes(args.phase,32768)
    if len(raw)>32768 or hashlib.sha256(raw).hexdigest()!=args.phase_sha256:raise RuntimeError('ROOT phase module binding')
    p=load_exact(args.phase,{'bytes':len(raw),'sha256':args.phase_sha256},'save_phase_adapter')
    ctx=p.load_context(args.context,args.context_sha256)
    if args.operation=='run':
        p.require(ctx['normalizerRelative']==ctx['componentPaths']['normalizer'],'normalizer component path binding')
        pin=ctx['sourcePins'][ctx['normalizerRelative']];p.require(pin['sha256']==NORMALIZER_SHA,'exact accepted normalizer')
        path=Path(ctx['driverRoot'])/ctx['normalizerRelative']
        n=load_exact(path,pin,'save_exact_normalizer');result=run(p,ctx,n);ok=result['ownerEligible']
    else:result=publish(p,ctx,args.operation=='final');ok=result['eligible']
    print(json.dumps(result,allow_nan=False));return 0 if ok else 2
if __name__=='__main__':sys.exit(main())
