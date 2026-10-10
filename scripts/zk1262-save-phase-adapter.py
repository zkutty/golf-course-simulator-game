"""SAVE-only authority. Inert import. ROOT supplies authenticated expected context.
No capture helper, renderer receipt, snapshot graph or journal-declared budget authority.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time

CANDIDATE = 'b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025'
CAP = 32768
TERM, KILL = 2820, 2880
PHASES = ('BUILD','NORMALIZE','PREPARE','DISCOVERY','READY','PRODUCER','CLEANUP','FINISH')
ALLOC = {'BUILD':600,'NORMALIZE':30,'PREPARE':120,'DISCOVERY':120,'READY':120,
         'PRODUCER':1980,'CLEANUP':60,'FINISH':30}
POLICY = {'parentTERM':2820,'parentKILL':2880,'build':600,'prepareShared':120,
          'producerTERM':1920,'producerKILL':1980,'cleanup':60,'normalizeFinishShared':30}
EXTERNAL = ('held-phase-prelaunch-boundary.json','external-phase-adjudication.json',
            'external-phase-adjudication-final.json')
METADATA = ('source-context.json','phase-intent.json','source-before.json','source-preproducer.json',
 'source-after.json','projection-proof.json','projection-before-producer.json','sdk-binding.json',
 'setup-status.json','producer-status.json','producer-exit.json','phase-journal.json','inventory.json',
 'save-actual-command-receipt.json','save-owner-validation.json')
PRODUCER = ('save-load-resource-stability.json','long-session-resource-stability.json',
 'editing-overlay-sleep-recovery.json','zk682-react-component-timing-cleanup.json','zk682-stability-final.png')
LOGS = ('producer.stdout.log','producer.stderr.log','discovery.log')
ROLE_CAPS = {**{k:65536 for k in METADATA+PRODUCER}, **{k:262144 for k in LOGS},
 'save-final-owner.heapsnapshot':134217728,'save-final-owner.heapsnapshot.part':134217728,
 'save-final-owner.preclose.json':32768}
ROLE_CAPS['zk682-stability-final.png'] = 8388608
ROLE_CAPS['phase-journal.json'] = CAP
AUDITS = ('baseline-audit.json','before.json','generated-audit.json','generated.json','normalized.json',
          'normalization-failure.json','before-failure.json','final.json','final-failure.json')
SPEC = 'e2e/zk1262-save-final-owner-diagnostic.e2e.ts'
RUNNER = 'scripts/zk1262-run-save-final-owner-diagnostic.mjs'
CHILD = ['npx','playwright','test',SPEC,'--workers=1','--retries=0']
KNOWN_SOURCE = {
 'simgolf-lite/'+SPEC:{'bytes':18463,'sha256':'5a78fd068355f9631de5cf85df886ae4ee3e6ae9251422c7e3bfe8876b1e0216'},
 'simgolf-lite/'+RUNNER:{'bytes':1809,'sha256':'2cb3dee0d204cbce1cc7ef1356323662ad0fcb83940292d7c726a744288d0095'},
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs':{'bytes':17547,'sha256':'917c4dcc17cce4714dc20008fdd845d9948df1eecd2ffd53ada5f14bc998bf54'},
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.d.mts':{'bytes':932,'sha256':'68ac78feee2b9bc48b2ece2f9f9f78c89e2ad47f46a8bf8f28afde61a9ca45c6'}}
ID_KEYS = {'repositoryId','candidate','driver','run','attempt','workflow','job','mode'}

class Refusal(RuntimeError):
    pass

def require(ok, text):
    if not ok: raise Refusal(text)

def finite(x):
    return type(x) in (int,float) and math.isfinite(x) and x >= 0

def equal(a,b):
    # JSON booleans must never compare equal to integer identity/status/cycle fields.
    if type(a) is not type(b): return False
    if isinstance(a,dict): return a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
    if isinstance(a,list): return len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a==b

def encoded(x):
    return (json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()

def digest(x):
    return hashlib.sha256(x).hexdigest()

def strict_json(data, cap=CAP):
    require(type(data) is bytes and len(data)<=cap,'JSON byte cap')
    def pairs(rows):
        out={}
        for k,v in rows:
            require(k not in out,'duplicate JSON key');out[k]=v
        return out
    def bad(value): raise Refusal('nonfinite JSON number: '+value)
    value=json.loads(data.decode('utf8','strict'),object_pairs_hook=pairs,parse_constant=bad)
    def walk(x,depth=0):
        require(depth<=32,'JSON depth')
        if type(x) is float: require(math.isfinite(x),'nonfinite JSON float')
        if type(x) is dict:
            require(len(x)<=256,'JSON object width')
            for v in x.values():walk(v,depth+1)
        if type(x) is list:
            require(len(x)<=512,'JSON array width')
            for v in x:walk(v,depth+1)
    walk(value);return value

def canonical(path):
    p=Path(path)
    require(p.is_absolute() and str(p)==os.path.realpath(p),'canonical absolute path')
    return p

def physical(p):
    s=Path(p).lstat()
    return {'dev':s.st_dev,'ino':s.st_ino}

def file_bytes(path,cap):
    p=Path(path);canonical(p.parent)
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a=os.fstat(fd)
        require(stat.S_ISREG(a.st_mode) and a.st_nlink==1 and a.st_size<=cap,'regular single-link/cap')
        require(physical(p)=={'dev':a.st_dev,'ino':a.st_ino},'opened inode mismatch')
        pieces=[];h=hashlib.sha256();n=0
        while True:
            part=os.read(fd,min(65536,cap-n+1))
            if not part:break
            n+=len(part);require(n<=cap,'stream byte cap');h.update(part);pieces.append(part)
        b=os.fstat(fd)
        require((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==
                (b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns),'read drift')
        require(n==a.st_size and physical(p)=={'dev':a.st_dev,'ino':a.st_ino},'read completeness/inode')
        return b''.join(pieces),{'bytes':n,'sha256':h.hexdigest(),'dev':a.st_dev,'ino':a.st_ino}
    finally:os.close(fd)

def stream_pin(path,cap):
    # Opaque files are never accumulated or decoded. Stable full streaming hash.
    p=Path(path);canonical(p.parent);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a=os.fstat(fd);require(stat.S_ISREG(a.st_mode) and a.st_nlink==1 and a.st_size<=cap,'opaque regular/cap')
        require(physical(p)=={'dev':a.st_dev,'ino':a.st_ino},'opaque inode')
        n=0;h=hashlib.sha256()
        while True:
            block=os.read(fd,65536)
            if not block:break
            n+=len(block);require(n<=cap,'opaque stream cap');h.update(block)
        b=os.fstat(fd)
        require((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==
                (b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns),'opaque read drift')
        require(n==a.st_size and physical(p)=={'dev':a.st_dev,'ino':a.st_ino},'opaque complete')
        return {'bytes':n,'sha256':h.hexdigest(),'dev':a.st_dev,'ino':a.st_ino}
    finally:os.close(fd)

def wx(path,value,cap=CAP):
    p=Path(path);canonical(p.parent);data=value if type(value) is bytes else encoded(value)
    require(len(data)<=cap,'output cap')
    fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'exclusive regular')
        pos=0
        while pos<len(data):
            n=os.write(fd,data[pos:]);require(n>0,'short output');pos+=n
        os.fsync(fd)
        require(os.pread(fd,cap+1,0)==data and physical(p)=={'dev':s.st_dev,'ino':s.st_ino},'output readback')
        parent=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:os.close(fd)
    return stream_pin(p,cap)

def identity(ctx):
    d=ctx['identity'];require(type(d) is dict and set(d)==ID_KEYS,'SAVE identity fields')
    require(type(d['repositoryId']) is int and d['repositoryId']==1120131901,'repository')
    require(d['candidate']==CANDIDATE and d['workflow']=='.github/workflows/zk1262-save-final-owner.yml'
      and d['job']=='save-final-owner' and d['mode']=='save-final-owner-b7fe','SAVE identity')
    require(type(d['run']) is int and 0<d['run']<=9007199254740991 and type(d['attempt']) is int
      and d['attempt']==1,'run/attempt')
    require(type(d['driver']) is str and re.fullmatch('[0-9a-f]{40}',d['driver']) is not None
      and d['driver']!=CANDIDATE,'immutable distinct driver')
    for name in ('targetRoot','driverRoot','artifactRoot','node'):
        require(type(ctx[name]) is str and Path(ctx[name]).is_absolute() and
                str(Path(ctx[name]))==ctx[name],'absolute context path')
    require(type(ctx['sourcePins']) is dict and 8<=len(ctx['sourcePins'])<=32,'ROOT source bindings')
    for path,pin in ctx['sourcePins'].items():
        require(type(path) is str and not path.startswith('/') and all(x not in ('','.','..') for x in path.split('/')),'source path')
        require(set(pin)=={'bytes','sha256'} and type(pin['bytes']) is int and 0<pin['bytes']<=65536
                and re.fullmatch('[0-9a-f]{64}',pin['sha256']) is not None,'source pin')
    require(type(ctx['componentPaths']) is dict and set(ctx['componentPaths'])=={'driver','phase','typed','normalizer','stabilityContract'},'ROOT exact component paths')
    required=set(ctx['componentPaths'].values())|{'.github/workflows/zk1262-save-final-owner.yml',
      'simgolf-lite/'+SPEC,'simgolf-lite/'+RUNNER,
      'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs',
      'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.d.mts'}
    require(required<=set(ctx['sourcePins']),'all workflow/adapter/projection source bindings')
    for path,pin in KNOWN_SOURCE.items():require(equal(ctx['sourcePins'][path],pin),'exact admitted SAVE source projection')
    require(equal(ctx['sourcePins'][ctx['componentPaths']['normalizer']],{'bytes':17794,'sha256':'75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'}),'exact unchanged normalizer source')
    require(equal(ctx['sourcePins'][ctx['componentPaths']['stabilityContract']],{'bytes':25593,'sha256':'16f4a1006eb9a7dcbe576ec0e2e7c4c6a73db49e8d8b91161c7ebed48b6a10b7'}),'exact unchanged stability contract source')
    require(set(ctx['nodePin'])=={'bytes','sha256'} and type(ctx['nodePin']['bytes']) is int
            and re.fullmatch('[0-9a-f]{64}',ctx['nodePin']['sha256']) is not None,'ROOT Node binding')
    return d

def commands(ctx):
    identity(ctx)
    return {'BUILD':['npm','run','build'],'NORMALIZE':['AuditOwner.normalize',True],
      'PREPARE':['four-exact-SAVE-projections','default-sdk-binding'],
      'DISCOVERY':CHILD+['--list'],'READY':['SAVE-source-sdk-discovery-ready'],
      'PRODUCER':[ctx['node'],RUNNER,'--output-dir',ctx['artifactRoot'],'--expected-commit',CANDIDATE],
      'CLEANUP':['four-owned-dev-ino-and-owned-empty-directory-only'],'FINISH':['AuditOwner.finish']}

def boot():
    require(os.name=='posix' and Path('/proc/sys/kernel/random/boot_id').exists(),'Linux boot authority required')
    value=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    require(re.fullmatch('[0-9a-f-]{36}',value) is not None,'Linux boot ID')
    return value

def seal(ctx):
    # ROOT invokes this before the original GNU timeout owner command. A journal
    # header or a marker reconstructed after launch is never an authority input.
    identity(ctx);root=Path(ctx['artifactRoot']);parent=canonical(root.parent)
    require(not root.exists() and not root.is_symlink(),'fresh legacy output required')
    external=Path(str(root)+'-external')
    require(not external.exists() and not external.is_symlink(),'fresh external sibling required')
    stamp=time.monotonic();boot_id=boot();p=physical(parent)
    os.mkdir(root,0o700);os.mkdir(external,0o700)
    require(physical(parent)==p,'parent drift on seal')
    marker={'schema':1,'kind':'SAVE_TRUSTED_PRELAUNCH_V1','identity':ctx['identity'],
      'sourcePins':ctx['sourcePins'],'nodePin':ctx['nodePin'],'commands':commands(ctx),'policy':POLICY,
      'clock':'Linux CLOCK_MONOTONIC','bootId':boot_id,'start':stamp,
      'root':ctx['artifactRoot'],'externalRoot':str(external),'parent':str(parent),
      'parentIdentity':p,'rootIdentity':physical(root),'externalIdentity':physical(external)}
    pin=wx(external/EXTERNAL[0],marker)
    return {'boundary':pin,'marker':marker,'qualification':'ROOT caller prelaunch; no archive self-authority'}

def boundary(marker,ctx,facts,pin):
    identity(ctx)
    require(set(marker)=={'schema','kind','identity','sourcePins','nodePin','commands','policy','clock','bootId',
                         'start','root','externalRoot','parent','parentIdentity','rootIdentity','externalIdentity'},'boundary fields')
    require(marker['schema']==1 and marker['kind']=='SAVE_TRUSTED_PRELAUNCH_V1','boundary kind')
    require(equal(marker['identity'],ctx['identity']) and equal(marker['sourcePins'],ctx['sourcePins'])
       and equal(marker['nodePin'],ctx['nodePin']) and equal(marker['commands'],commands(ctx))
       and equal(marker['policy'],POLICY),'boundary source/identity/argv/policy')
    require(finite(marker['start']) and marker['clock']=='Linux CLOCK_MONOTONIC','clock domain')
    require(marker['root']==ctx['artifactRoot'] and marker['externalRoot']==ctx['artifactRoot']+'-external'
       and marker['parent']==str(Path(ctx['artifactRoot']).parent),'sibling layout')
    require(equal(pin,facts['boundary']) and equal(marker['bootId'],facts['bootId'])
       and equal(marker['rootIdentity'],facts['rootIdentity']) and equal(marker['externalIdentity'],facts['externalIdentity'])
       and equal(marker['parentIdentity'],facts['parentIdentity'])
       and equal(marker['start'],facts['prelaunchStart']),'authenticated producer physical/clock facts')
    for key in ('rootIdentity','externalIdentity','parentIdentity'):
        require(set(marker[key])=={'dev','ino'} and all(type(v) is int and v>=0 for v in marker[key].values()),'dev/ino types')
    require(marker['rootIdentity']!=marker['externalIdentity'],'separate root inode')
    return marker['start']

def receipt_validate(receipt,ctx,end=None):
    keys={'schema','kind','identity','outerRunnerArgv','sourceQualifiedChildArgv','cwdRole','outerEntered',
      'outerWaited','outerCompleted','outerExitCode','outerSignal','timeoutPresent','firstCausePresent','firstCause',
      'startedMonotonic','endedMonotonic','observedClosureQualification'}
    require(type(receipt) is dict and set(receipt)==keys,'neutral receipt exact fields')
    require(receipt['schema']==1 and receipt['kind']=='SAVE_ACTUAL_OUTER_RUNNER_WAIT_V1','SAVE receipt kind')
    require(equal(receipt['identity'],identity(ctx)) and equal(receipt['outerRunnerArgv'],commands(ctx)['PRODUCER'])
       and equal(receipt['sourceQualifiedChildArgv'],CHILD) and receipt['cwdRole']==ctx['targetRoot']+'/simgolf-lite','receipt independent argv/cwd')
    for k in ('outerEntered','outerWaited','outerCompleted','timeoutPresent','firstCausePresent'):
        require(type(receipt[k]) is bool,'receipt flag type')
    require(receipt['observedClosureQualification']=='OUTER_NODE_WAIT_ONLY_NESTED_CHILD_UNKNOWN','no invented child closure')
    require(receipt['firstCausePresent'] or receipt['firstCause'] is None,'absent first cause')
    require(receipt['outerExitCode'] is None or type(receipt['outerExitCode']) is int and 0<=receipt['outerExitCode']<=255,'outer exit type')
    require(receipt['outerSignal'] is None or type(receipt['outerSignal']) is int and 0<receipt['outerSignal']<=64,'outer signal type')
    require(not(receipt['outerSignal'] is not None and receipt['outerExitCode'] is not None),'exit vs signal')
    require(finite(receipt['startedMonotonic']) and finite(receipt['endedMonotonic']) and
            receipt['endedMonotonic']>=receipt['startedMonotonic'],'receipt timestamps')
    if not all(receipt[k] is True for k in ('outerEntered','outerWaited','outerCompleted')) or receipt['timeoutPresent'] or (end is not None and receipt['endedMonotonic']>end):return 'UNKNOWN'
    if receipt['firstCausePresent'] or receipt['outerSignal'] is not None or receipt['outerExitCode']!=0:return 'FAIL'
    return 'RUNNER_COMPLETED_ONLY'

def lifecycle(journal,receipt,ctx):
    # Structural validator deliberately does not establish shared budget authority.
    require(type(journal) is dict and set(journal)=={'schema','identity','sourcePins','commands','phases','terminal'},'journal schema')
    require(journal['schema']==1 and equal(journal['identity'],identity(ctx)) and
      equal(journal['sourcePins'],ctx['sourcePins']) and equal(journal['commands'],commands(ctx)),'journal context')
    rows=journal['phases'];require(type(rows) is list and len(rows)==8,'phase coverage')
    last=-1;prep=None
    for index,row in enumerate(rows):
        require(set(row)=={'phase','entry','exit','ceiling','allocation','outcome','result'},'phase row fields')
        require(row['phase']==PHASES[index] and row['outcome'] in ('PASS','FAIL','UNKNOWN','SKIPPED'),'phase order/outcome')
        if row['outcome']=='SKIPPED':require(row['entry'] is None and row['exit'] is None,'skipped timestamps');continue
        require(finite(row['entry']) and finite(row['exit']) and row['exit']>=row['entry']>=last,'phase monotonic')
        require(finite(row['allocation']) and 0<row['allocation']<=ALLOC[row['phase']] and finite(row['ceiling']),'allocation')
        require(row['exit']<=row['ceiling'],'declared ceiling exceeded');last=row['exit']
        if row['phase']=='PREPARE':prep=row['ceiling']
        if row['phase'] in ('PREPARE','DISCOVERY','READY'):require(row['ceiling']==prep,'common declared ceiling')
    producer=rows[5]
    require(producer['outcome']=='SKIPPED' or producer['entry']<=receipt['startedMonotonic']<=receipt['endedMonotonic']<=producer['exit'],'actual receipt inside producer phase')
    if all(row['outcome']=='PASS' for row in rows):
        require(type(rows[0]['result'].get('exitCode')) is int and rows[0]['result'].get('exitCode')==0 and rows[0]['result'].get('actualOuterWait') is True,'real bounded successful build result')
        require(rows[1]['result'].get('producerEligible') is True and rows[2]['result'].get('fourProjections') is True
          and rows[2]['result'].get('sdk') is True and rows[4]['result'].get('ready') is True,'normalization/projection/ready results')
        require(rows[5]['result'].get('runnerCompletedOnly') is True and rows[5]['result'].get('nestedChildClosure')=='UNKNOWN'
          and rows[7]['result'].get('finalSourceEligible') is True,'producer/final result qualification')
    t=journal['terminal'];require(set(t)=={'firstCausePresent','firstCause','secondary','audit','projection','discovery','sdk','sources','descriptorsClosed'},'terminal fields')
    require(type(t['firstCausePresent']) is bool and (t['firstCausePresent'] or t['firstCause'] is None),'terminal presence')
    require(type(t['secondary']) is list and len(t['secondary'])<=16,'secondary cap')
    r=receipt_validate(receipt,ctx)
    audit=t['audit']
    require(type(audit) is dict and all(audit.get(k) is True for k in ('oneOwner','beforeBuild','normalizeOnce','buildSucceeded','normalized','strictFinish')),'same owner lifecycle')
    require(t['descriptorsClosed'] is True and t['sources'] is True and t['sdk'] is True,'source SDK descriptors')
    require(type(t['projection']) is dict and t['projection'].get('inverse') is True
       and t['projection'].get('created')==4 and t['projection'].get('removed')==4
       and t['projection'].get('ownedEmptyDirectoryRemoved') is True,'four own-only cleanup')
    require(equal(t['discovery'],{'tests':1,'files':[ctx['targetRoot']+'/simgolf-lite/'+SPEC]}),'exact discovery')
    success=all(row['outcome']=='PASS' for row in rows) and not t['firstCausePresent'] and r=='RUNNER_COMPLETED_ONLY'
    return {'eligible':success,'receipt':r,'terminal':t,'qualification':'SAVE structural lifecycle; fixed policy separately required'}

def fixed_deadlines(journal,marker,ctx,facts,pin,receipt,now):
    start=boundary(marker,ctx,facts,pin);require(finite(now) and now>=start,'trusted replay/live clock')
    rows=journal['phases'];require(type(rows) is list and len(rows)==8,'fixed coverage')
    term=start+TERM;kill=start+KILL;prep=None;normal_elapsed=0;producer_end=None;last=start
    for i,row in enumerate(rows):
        require(row['phase']==PHASES[i],'fixed phase order')
        if row['outcome']=='SKIPPED':continue
        e,x=row['entry'],row['exit'];require(finite(e) and finite(x) and start<=last<=e<=x<=term,'authoritative parent TERM/monotonic')
        require(finite(row['allocation']) and 0<row['allocation']<=ALLOC[row['phase']],'fixed allocation maximum')
        ceiling=min(term,e+row['allocation'])
        if row['phase']=='PREPARE':prep=min(term,e+120)
        if row['phase'] in ('PREPARE','DISCOVERY','READY'):
            require(prep is not None,'first PREPARE required');ceiling=min(ceiling,prep)
            require(row['ceiling']==prep,'authoritative shared PREPARE ceiling')
        else:require(row['ceiling']==ceiling,'effective component ceiling')
        require(x<=ceiling,'component late completion')
        if row['phase'] in ('NORMALIZE','FINISH'):
            normal_elapsed+=x-e;require(normal_elapsed<=30,'normalize/finish shared30')
        if row['phase']=='PRODUCER':producer_end=ceiling
        last=x
    require(now<=term and now<kill,'publication TERM/KILL refusal')
    require(producer_end is not None and receipt_validate(receipt,ctx,producer_end)=='RUNNER_COMPLETED_ONLY','producer completion within fixed bound')
    return {'eligible':True,'start':start,'TERM':term,'KILL':kill,'prepareCeiling':prep,'normalizeFinishElapsed':normal_elapsed}

def adjudicate(journal,receipt,marker,ctx,facts,pin,now,input_pins,role):
    require(role in EXTERNAL[1:],'external verdict role')
    value={'schema':1,'kind':'SAVE_EXTERNAL_FIXED_POLICY_V1','role':role,'identity':ctx['identity'],
      'sourcePins':ctx['sourcePins'],'inputPins':input_pins,'boundary':pin,'policy':POLICY,
      'trusted':False,'eligible':False,'outcome':'UNKNOWN','firstCausePresent':False,'firstCause':None,'secondary':[]}
    errors=[]
    for label,call in [('lifecycle',lambda:lifecycle(journal,receipt,ctx)),
      ('fixed',lambda:fixed_deadlines(journal,marker,ctx,facts,pin,receipt,now))]:
        try:value[label]=call()
        except BaseException as error:errors.append({'predicate':label,'error':str(error)[:512]})
    if errors:
        t=journal.get('terminal',{}) if type(journal) is dict else {}
        if t.get('firstCausePresent') is True:
            value['firstCausePresent']=True;value['firstCause']=t.get('firstCause')
            value['secondary']=(t.get('secondary',[])+errors)[:16]
        else:
            value['firstCausePresent']=True;value['firstCause']=errors[0];value['secondary']=errors[1:]
    elif value['lifecycle']['eligible'] and value['fixed']['eligible']:
        value.update(trusted=True,eligible=True,outcome='PASS')
    else:
        value['outcome']='FAIL' if value.get('lifecycle',{}).get('receipt')=='FAIL' else 'UNKNOWN'
        t=journal.get('terminal',{});value['firstCausePresent']=t.get('firstCausePresent') is True
        value['firstCause']=t.get('firstCause') if value['firstCausePresent'] else None
        value['secondary']=t.get('secondary',[])[:16]
    return value

def inventory(root,required=()):
    root=canonical(root);before=physical(root);rows={};used=0;inodes=set()
    for item in sorted(root.iterdir()):
        require(item.name in ROLE_CAPS,'foreign SAVE role: '+item.name)
        p=stream_pin(item,ROLE_CAPS[item.name]);pair=(p['dev'],p['ino'])
        require(pair not in inodes,'inventory inode collision');inodes.add(pair)
        used+=p['bytes'];require(used<=1073741824 and len(rows)<128,'inventory aggregate/count')
        rows[item.name]=p
    require(set(required)<=set(rows),'missing SAVE role')
    require(physical(root)==before,'inventory root drift')
    return {'root':str(root),'rootIdentity':before,'files':rows,'bytes':used,
      'coexistingRawAndPart':all(k in rows for k in ('save-final-owner.heapsnapshot','save-final-owner.heapsnapshot.part'))}

def load_context(path,expected_sha):
    raw,_=file_bytes(path,CAP);require(digest(raw)==expected_sha,'ROOT context bytes')
    ctx=strict_json(raw);identity(ctx);return ctx

def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['seal']);p.add_argument('--context',required=True)
    p.add_argument('--context-sha256',required=True);args=p.parse_args()
    ctx=load_context(args.context,args.context_sha256);print(json.dumps(seal(ctx),allow_nan=False))
if __name__=='__main__':main()
