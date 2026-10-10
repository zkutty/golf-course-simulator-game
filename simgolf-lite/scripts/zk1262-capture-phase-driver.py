"""Finite hosted diagnostic guards/publication. Never restore source or grant certification."""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess

CANDIDATE = 'b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025'
WORKFLOW = '.github/workflows/zk1262-capture-phase.yml'
MODE = 'capture-phase-b7fe'
PINS = {'simgolf-lite/package.json': {'bytes': 11208, 'sha256': '6bdbf6af0dca94b79d3025f73b4558ed555b243e03c2ef0ef8c6f42530cdf951'}, 'simgolf-lite/playwright.config.ts': {'bytes': 697, 'sha256': '35d7a3e1c5bf4c00508ff1cfd2510a2bc1306c3243eacac924a9b0940327a948'}, 'simgolf-lite/e2e/zk682-resource-growth.e2e.ts': {'bytes': 15221, 'sha256': 'cd238c429bb3c4745b903124442409ad1309e5f6a368ddbf81cd376c2f907142'}, 'simgolf-lite/e2e/zk682-stability.e2e.ts': {'bytes': 17333, 'sha256': 'c45b0cf36a725fbe4da0de4877cdac016e29c334f63f1a3b674edfb20bdd2a45'}, 'simgolf-lite/scripts/zk682-run-resource-growth.mjs': {'bytes': 2105, 'sha256': '49206a32a5d47386e4695098cf53b06812d1f352745752dd7fd2be7ecedf48a2'}, 'simgolf-lite/scripts/zk682-run-stability.mjs': {'bytes': 1790, 'sha256': '43587e0f25cba83c3fe0f16884a91e291cf7bce7e813bd5c9a9805e038393647'}}
TOOLS = {'simgolf-lite/scripts/zk1262-capture-diagnostic/observer.mjs': {'bytes': 7906, 'sha256': '0e3ef8a3a1c9be3fcbaee7a2d8a218e643ba59bb5b5ca1a94f52f5bb993ac04f'}, 'simgolf-lite/scripts/zk1262-capture-diagnostic/zk682-public-canvas-capture.mjs': {'bytes': 27135, 'sha256': '39af10efeb1e26a3e8011bcf159f859a9731001226b2a6784f27a63c5c93c166'}, 'simgolf-lite/e2e/zk1262-capture-phase-diagnostic.e2e.ts': {'bytes': 15657, 'sha256': '42fafcd2333680f41d37d2cce8b4fa00d11685e67e5bccb455cbb5804a582e18'}, 'simgolf-lite/scripts/zk1262-run-capture-phase-diagnostic.mjs': {'bytes': 2115, 'sha256': '0974c139227f02120c6af478fff26871480028a9eaa07eb6bf28f59fba7dfdee'}}
IMPORTS = {'simgolf-lite/scripts/react-component-timing-cleanup.mjs': {'bytes': 1263, 'sha256': 'f61a7d4218c736b0fff536a0f875a69dfa82edb56c5d2993c3d4bc56273760c2'}, 'simgolf-lite/scripts/zk682-resource-growth-contract.mjs': {'bytes': 9291, 'sha256': '9c9ad1d355bfe724c567c39e79abc370c256d36d101a4398e53f9dc21b99df27'}, 'simgolf-lite/scripts/zk682-command-receipt.mjs': {'bytes': 3286, 'sha256': 'edad908429a7d7c9d5528ddc216287ba9aa3a6063eb1a49adcd2e10e7a1201dc'}}
MAPS = [{'source': '/private/tmp/golf-b7fe-capture-observer-stageA-source-1/observer.mjs', 'target': 'simgolf-lite/scripts/zk1262-capture-diagnostic/observer.mjs', 'before': {'bytes': 7906, 'sha256': '0e3ef8a3a1c9be3fcbaee7a2d8a218e643ba59bb5b5ca1a94f52f5bb993ac04f'}, 'after': {'bytes': 7906, 'sha256': '0e3ef8a3a1c9be3fcbaee7a2d8a218e643ba59bb5b5ca1a94f52f5bb993ac04f'}, 'replacements': [], 'inverse': 'Reverse replacements in reverse order with exact count1; full original byte length/hash must match. Observer has zero replacements and is byteexact.'}, {'source': '/private/tmp/golf-b7fe-capture-observer-stageA-source-1/generated/zk682-public-canvas-capture.mjs', 'target': 'simgolf-lite/scripts/zk1262-capture-diagnostic/zk682-public-canvas-capture.mjs', 'before': {'bytes': 27136, 'sha256': '80586fbf201661365f2817bf0ad05714bc6ecc3b20d67301d7fd52874ab57e74'}, 'after': {'bytes': 27135, 'sha256': '39af10efeb1e26a3e8011bcf159f859a9731001226b2a6784f27a63c5c93c166'}, 'replacements': [{'before': "from '../observer.mjs'", 'after': "from './observer.mjs'", 'count': 1}], 'inverse': 'Reverse replacements in reverse order with exact count1; full original byte length/hash must match. Observer has zero replacements and is byteexact.'}, {'source': '/private/tmp/golf-b7fe-capture-observer-stageA-source-1/generated/zk682-resource-growth.e2e.ts', 'target': 'simgolf-lite/e2e/zk1262-capture-phase-diagnostic.e2e.ts', 'before': {'bytes': 15588, 'sha256': '2e4beeb2884eb241c0802b4b68bdd05fee1fdc4d334e6ec895c601ac1b59890c'}, 'after': {'bytes': 15657, 'sha256': '42fafcd2333680f41d37d2cce8b4fa00d11685e67e5bccb455cbb5804a582e18'}, 'replacements': [{'before': 'from "./zk682-public-canvas-capture.mjs"', 'after': 'from "../scripts/zk1262-capture-diagnostic/zk682-public-canvas-capture.mjs"', 'count': 1}, {'before': 'from "../observer.mjs"', 'after': 'from "../scripts/zk1262-capture-diagnostic/observer.mjs"', 'count': 1}], 'inverse': 'Reverse replacements in reverse order with exact count1; full original byte length/hash must match. Observer has zero replacements and is byteexact.'}, {'source': '/private/tmp/golf-5c236-remaining-source-inputs-1/simgolf-lite/scripts/zk682-run-resource-growth.mjs', 'target': 'simgolf-lite/scripts/zk1262-run-capture-phase-diagnostic.mjs', 'before': {'bytes': 2105, 'sha256': '49206a32a5d47386e4695098cf53b06812d1f352745752dd7fd2be7ecedf48a2'}, 'after': {'bytes': 2115, 'sha256': '0974c139227f02120c6af478fff26871480028a9eaa07eb6bf28f59fba7dfdee'}, 'replacements': [{'before': '"e2e/zk682-resource-growth.e2e.ts"', 'after': '"e2e/zk1262-capture-phase-diagnostic.e2e.ts"', 'count': 1}], 'inverse': 'Reverse replacements in reverse order with exact count1; full original byte length/hash must match. Observer has zero replacements and is byteexact.'}]

RECEIPT_KEYS = {'schemaVersion','kind','receiptId','candidateCommit','capturedAt','command','exitCode','durationMs','passed'}
RECEIPT_ARGV = ['npx','playwright','test','e2e/zk1262-capture-phase-diagnostic.e2e.ts','--workers=1','--retries=0']
ROLES = {'source-context.json':65536,'phase-intent.json':32768,'source-before.json':32768,'source-preproducer.json':32768,'source-after.json':32768,'projection-proof.json':32768,'sdk-binding.json':65536,'setup-status.json':32768,'producer-status.json':32768,'renderer-resource-growth.json':1048576,'renderer-resource-growth-command.json':65536,'zk682-react-component-timing-cleanup.json':8192,'zk682-capture-phase-ledger.json':8192,'zk682-canvas-capture-receipt.json':65536,'zk682-resource-growth-final.png':1048576,'producer.stdout.log':1073741824,'producer.stderr.log':1073741824,'discovery.log':262144,'inventory.json':65536,'projection-before-producer.json':32768,'producer-exit.json':32768}


def require(ok,message):
    if not ok: raise ValueError(message)


def strict_json(data,cap=65536):
    require(type(data) is bytes and 0 < len(data) <= cap,'JSON cap')
    def pairs(rows):
        result={}
        for k,v in rows:
            require(k not in result,'duplicate JSON key');result[k]=v
        return result
    def constant(v): raise ValueError('nonfinite JSON constant')
    value=json.loads(data.decode('utf-8',errors='strict'),object_pairs_hook=pairs,parse_constant=constant)
    def walk(v):
        if type(v) is float: require(math.isfinite(v),'nonfinite JSON number')
        elif type(v) is dict:
            for x in v.values():walk(x)
        elif type(v) is list:
            for x in v:walk(x)
    walk(value);return value


def canonical(p):
    p=Path(p)
    require(p.is_absolute() and str(p.resolve()) == str(p),'canonical path required')
    require(not p.is_symlink(),'symlink refused')
    return p


def ident(s): return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)


def file_bytes(p,cap):
    p=canonical(p);before=p.lstat();require(stat.S_ISREG(before.st_mode) and 0<=before.st_size<=cap,'regular file cap')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        require(ident(os.fstat(fd))==ident(before),'opened inode mismatch')
        data=b''
        while True:
            part=os.read(fd,min(65536,cap+1-len(data)))
            if not part:break
            data+=part;require(len(data)<=cap,'file grew past cap')
        require(ident(os.fstat(fd))==ident(before),'fd changed')
    finally:os.close(fd)
    require(ident(p.lstat())==ident(before),'path changed')
    return data,{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'dev':before.st_dev,'ino':before.st_ino}


def stream_pin(p,cap=536870912,allow_empty=False):
    p=canonical(p);before=p.lstat();require(stat.S_ISREG(before.st_mode) and (before.st_size>0 or allow_empty) and before.st_size<=cap,'binary/source stream cap')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);digest=hashlib.sha256();count=0
    try:
        require(ident(os.fstat(fd))==ident(before),'stream opened mismatch')
        while True:
            part=os.read(fd,65536)
            if not part:break
            count+=len(part);require(count<=cap,'stream cap');digest.update(part)
        require(ident(os.fstat(fd))==ident(before),'stream fd changed')
    finally:os.close(fd)
    require(ident(p.lstat())==ident(before),'stream path changed')
    return {'path':str(p),'bytes':count,'sha256':digest.hexdigest()}


def wx(p,value,cap=32768):
    p=Path(p);require(p.is_absolute() and os.path.normpath(str(p))==str(p),'output absolute')
    parent=canonical(p.parent);before=parent.lstat();require(stat.S_ISDIR(before.st_mode),'output parent')
    data=(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n').encode();require(len(data)<=cap,'output cap')
    fd=None;owned=None
    try:
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);owned=os.fstat(fd)
        require(stat.S_ISREG(owned.st_mode),'owned regular');after=parent.lstat();require((before.st_dev,before.st_ino)==(after.st_dev,after.st_ino),'parent drift')
        offset=0
        while offset<len(data):
            n=os.write(fd,data[offset:]);require(n>0,'write progress');offset+=n
        os.fsync(fd);os.close(fd);fd=None;final=p.lstat();require((final.st_dev,final.st_ino)==(owned.st_dev,owned.st_ino) and stat.S_ISREG(final.st_mode),'final ownership')
    except BaseException:
        if fd is not None:os.close(fd)
        if owned is not None:
            try:
                final=p.lstat()
                if stat.S_ISREG(final.st_mode) and (final.st_dev,final.st_ino)==(owned.st_dev,owned.st_ino):p.unlink()
            except OSError:pass
        raise
    return owned.st_dev,owned.st_ino


def git(repo,*args):
    result=subprocess.run(['git','-C',str(canonical(repo)),*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    require(result.returncode==0 and len(result.stdout)<=1048576 and len(result.stderr)<=262144,'bounded Git command failed')
    return result.stdout


def roles(env):
    source=env.get('CAPTURE_SOURCE_SHA','');candidate=env.get('CAPTURE_CANDIDATE_SHA','')
    require(candidate==CANDIDATE,'exact candidate input')
    require(re.fullmatch('[0-9a-f]{40}',source) is not None and source==env.get('GITHUB_SHA') and source!=candidate,'immutable distinct source input')
    run=env.get('GITHUB_RUN_ID','');require(run.isascii() and run.isdigit() and 0<int(run)<=9007199254740991 and env.get('GITHUB_RUN_ATTEMPT')=='1','run1 roles')
    require(env.get('GITHUB_EVENT_NAME')=='workflow_dispatch','dispatch only')
    return {'candidate_sha':candidate,'driver_sha':source,'run_id':int(run),'run_attempt':1,'workflow_path':WORKFLOW,'mode':MODE,'artifact_role':'capture-host-phase-ledger'}


def first_failure(state,phase,error):
    if not state.get('firstFailurePresent',False):
        state['firstFailurePresent']=True;state['firstFailure']={'phase':phase,'error':error}


def source_guard(repo,expected,pins,owned=None,post=False):
    repo=canonical(repo);status=git(repo,'status','--porcelain=v1','-z','--untracked-files=all')
    records=[];tracked=[];extra=[]
    parts=status.split(b'\0');i=0
    while i<len(parts):
        part=parts[i];i+=1
        if not part:continue
        require(len(part)>=4,'status record shape');code=part[:2].decode('ascii');name=part[3:].decode('utf-8',errors='strict')
        item={'code':code,'path':name};records.append(item)
        if 'R' in code or 'C' in code:
            require(i<len(parts) and parts[i],'rename source');item['oldPath']=parts[i].decode('utf-8',errors='strict');i+=1
        if code=='??':
            if owned is None or name not in owned:extra.append(name)
        else:tracked.append(item)
    head=git(repo,'rev-parse','HEAD').decode().strip();pin_results={};pin_errors=[]
    for relative,expected_pin in pins.items():
        try:
            _,actual=file_bytes(repo/relative,65536)
            actual_pin={k:actual[k] for k in ('bytes','sha256')};pin_results[relative]=actual_pin
            if actual_pin!=expected_pin:pin_errors.append(relative)
        except (ValueError,OSError):pin_errors.append(relative)
    owned_errors=[]
    if owned is not None:
        for relative,ownership in owned.items():
            try:
                _,actual=file_bytes(repo/relative,65536)
                if any(actual[k]!=ownership[k] for k in ('bytes','sha256','dev','ino')):owned_errors.append(relative)
            except (ValueError,OSError):owned_errors.append(relative)
    # Normal reporter files after workload are recorded; no blanket post-run untracked-cleanliness predicate.
    ok=head==expected and not tracked and not pin_errors and not owned_errors and (post or not extra)
    return {'ok':ok,'head':head,'expectedHead':expected,'statusRecords':records,'trackedChanges':tracked,'untrackedExtra':extra,'untrackedPostPredicate':not post,'sourcePins':pin_results,'pinErrors':pin_errors,'ownedProjectionErrors':owned_errors}


def driver_guard(driver,expected):
    driver=canonical(driver);require(git(driver,'rev-parse','HEAD').decode().strip()==expected,'driver HEAD')
    require(git(driver,'status','--porcelain=v1','-z','--untracked-files=all')==b'','driver clean')
    wanted=[WORKFLOW,'simgolf-lite/scripts/zk1262-capture-phase-workflow.test.mjs','simgolf-lite/scripts/zk1262-capture-phase-driver.py',*TOOLS]
    actual={}
    for relative in wanted:
        data,pin=file_bytes(driver/relative,65536);committed=git(driver,'show',expected+':'+relative)
        require(data==committed,'driver committed-source drift')
        actual[relative]={k:pin[k] for k in ('bytes','sha256')}
        if relative in TOOLS:require(actual[relative]==TOOLS[relative],'driver diagnostic copy pin')
    return actual


def invert_projection(data,row):
    require(len(data)==row['after']['bytes'] and hashlib.sha256(data).hexdigest()==row['after']['sha256'],'accepted projected pin')
    text=data.decode('utf-8')
    for change in reversed(row['replacements']):
        require(change['count']==1 and text.count(change['after'])==1,'inverse literal count');text=text.replace(change['after'],change['before'],1)
    before=text.encode();require(len(before)==row['before']['bytes'] and hashlib.sha256(before).hexdigest()==row['before']['sha256'],'full original inverse')
    return before


def project_copies(driver,target):
    driver,target=canonical(driver),canonical(target);owned={}
    for relative,pin in TOOLS.items():
        data,source=file_bytes(driver/relative,65536);require({k:source[k] for k in ('bytes','sha256')}==pin,'accepted projection delivery')
        row=next(x for x in MAPS if x['target']==relative);invert_projection(data,row)
        destination=target/relative;destination.parent.mkdir(parents=True,exist_ok=True);canonical(destination.parent)
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            before=os.fstat(fd);offset=0
            while offset<len(data):
                n=os.write(fd,data[offset:]);require(n>0,'copy progress');offset+=n
            final=os.fstat(fd);require((before.st_dev,before.st_ino)==(final.st_dev,final.st_ino),'copy fd ownership')
        finally:os.close(fd)
        _,current=file_bytes(destination,65536);require({k:current[k] for k in ('bytes','sha256')}==pin,'copy final pin')
        require((current['dev'],current['ino'])==(before.st_dev,before.st_ino),'copy final ownership');owned[relative]=current
    return owned


RECEIPT_JS = r"""import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {inspectZk682CommandReceipt}=await import(pathToFileURL(process.argv[1]).href);
const receipt=JSON.parse(fs.readFileSync(0,'utf8'));
const inspected=inspectZk682CommandReceipt(receipt,{candidateCommit:process.argv[2],receiptId:'renderer-resource-growth'});
if(!inspected.valid)throw new Error(inspected.errors.join('; '));
const exact=['npx','playwright','test','e2e/zk1262-capture-phase-diagnostic.e2e.ts','--workers=1','--retries=0'];
if(JSON.stringify(receipt.command)!==JSON.stringify(exact))throw new Error('exact diagnostic argv required');
console.log(JSON.stringify({valid:true,passed:inspected.passed,exitCode:receipt.exitCode}));"""


def receipt(data,target):
    value=strict_json(data,65536);require(type(value) is dict and set(value)==RECEIPT_KEYS,'receipt exact shape')
    require(type(value['schemaVersion']) is int and value['schemaVersion']==1,'receipt schema primitive')
    require(type(value['exitCode']) is int and value['exitCode']>=0,'receipt integer exit')
    require(type(value['durationMs']) in (int,float) and math.isfinite(value['durationMs']) and value['durationMs']>=0,'receipt duration')
    require(type(value['passed']) is bool and value['passed']==(value['exitCode']==0),'receipt passed derivation')
    require(value['command']==RECEIPT_ARGV,'receipt exact diagnostic argv')
    module=canonical(target)/'simgolf-lite/scripts/zk682-command-receipt.mjs'
    _,pin=file_bytes(module,65536);require({k:pin[k] for k in ('bytes','sha256')}==IMPORTS['simgolf-lite/scripts/zk682-command-receipt.mjs'],'canonical inspector pin')
    result=subprocess.run(['node','--input-type=module','-e',RECEIPT_JS,str(module),CANDIDATE],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    require(result.returncode==0 and len(result.stdout)<=65536 and len(result.stderr)<=65536,'canonical receipt inspection failed')
    return strict_json(result.stdout)


SDK_JS = r"""import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const req=createRequire(path.resolve(process.argv[1],'package.json'));
const pkg=req.resolve('playwright-core/package.json');const root=path.dirname(pkg);
const core=JSON.parse(fs.readFileSync(pkg,'utf8')),test=JSON.parse(fs.readFileSync(req.resolve('@playwright/test/package.json'),'utf8'));
if(core.version!=='1.61.1'||test.version!=='1.61.1'||process.platform!=='linux'||process.arch!=='x64')throw new Error('exact SDK Linuxx64 required');
console.log(JSON.stringify({corePackage:pkg,testPackage:req.resolve('@playwright/test/package.json'),bundle:path.join(root,'lib/coreBundle.js'),registry:path.join(root,'browsers.json'),testEntry:req.resolve('@playwright/test'),platform:process.platform,arch:process.arch,version:core.version}));"""


def select_default_shell(public,registry,env):
    selected=[]
    for name in ('chromium','chromium-headless-shell'):
        matches=[x for x in registry['browsers'] if x.get('name')==name];require(len(matches)==1,'unique SDK registry browser')
        entry=matches[0];require(entry.get('revision')=='1228' and entry.get('browserVersion')=='149.0.7827.55' and 'revisionOverrides' not in entry,'supported exact registry revision');selected.append(entry)
    require(not any(env.get(k) for k in ('PWDEBUG','SELENIUM_REMOTE_URL')),'unsupported selector environment')
    public=canonical(public);require(public.parts[-3:]==('chromium-1228','chrome-linux64','chrome'),'exact fullChrome reference')
    cache=canonical(public.parent.parent.parent)
    return canonical(cache/'chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell')


def sdk_binding(target):
    target=canonical(target);result=subprocess.run(['node','--input-type=module','-e',SDK_JS,str(target/'simgolf-lite')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    require(result.returncode==0 and len(result.stdout)<=65536 and len(result.stderr)<=65536,'public SDK metadata failed')
    info=strict_json(result.stdout);registry_data,_=file_bytes(Path(info['registry']),65536);registry=strict_json(registry_data)
    bundle=stream_pin(Path(info['bundle']));registry_pin=stream_pin(Path(info['registry']))
    core_package=stream_pin(Path(info['corePackage']))
    require(core_package['bytes']==876 and core_package['sha256']=='759e376f995bf39edd4810d699b99469bab1d7428b6fbc78d41912f367df7ba9','version-bound SDK package')
    require(bundle['bytes']==3352341 and bundle['sha256']=='6be5c2ea035554e9b184b1dbc7aa5e7f1fb428dd1b5c202022858dcfae9bee27','version-bound SDK source')
    require(registry_pin['bytes']==1939 and registry_pin['sha256']=='ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942','version-bound registry')
    require(not any(os.environ.get(k) for k in ('PWDEBUG','SELENIUM_REMOTE_URL')),'unsupported debug/remote selector environment')
    public_result=subprocess.run(['node','--input-type=module','-e',"const {chromium}=await import(process.argv[1]);console.log(JSON.stringify({path:chromium.executablePath()}));",info['testEntry']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    require(public_result.returncode==0 and len(public_result.stdout)<=65536 and len(public_result.stderr)<=65536,'public executablePath metadata')
    public_info=strict_json(public_result.stdout)
    require(stream_pin(Path(info['bundle']))==bundle and stream_pin(Path(info['registry']))==registry_pin,'SDK selection source drift')
    public=canonical(Path(public_info['path']));shell=select_default_shell(public,registry,os.environ)
    require(os.access(shell,os.X_OK),'headless executable required')
    binding={'playwrightVersion':'1.61.1','platform':'linux','arch':'x64','browserName':'chromium','browserVersion':'UNKNOWN_UNTIL_ORIGINAL_REPORT',
             'expectedBrowserVersion':'149.0.7827.55','defaultHeadlessBinary':stream_pin(shell),'publicFullChromeReference':stream_pin(public),
             'bundle':bundle,'registry':registry_pin,'corePackage':core_package,'testPackage':stream_pin(Path(info['testPackage'])),
             'selectionQualification':'Source-bound default no-channel headless; original producer launchOptions only precise-memory-info and no executablePath/channel/backend override. No extra browser launch or default DEBUG override.',
             'actualVersionQualification':'Original numerical report page.context().browser().version() only; absent report remains UNKNOWN.'}
    return binding


def inventory(root):
    root=canonical(root);before=root.lstat();entries=[];total=0;errors=[]
    names=list(root.iterdir());require(len(names)<=128,'raw file count')
    for p in sorted(names,key=lambda x:x.name):
        require(p.name in ROLES and p.parent==root,'unexpected artifact role/path')
        if p.name=='inventory.json':raise ValueError('inventory wx output already exists')
        try:
            if p.suffix=='.json':
                data,pin=file_bytes(p,ROLES[p.name]);strict_json(data,ROLES[p.name])
            else:pin=stream_pin(p,ROLES[p.name],allow_empty=True)
            total+=pin['bytes'];require(total<=1073741824,'raw aggregate cap')
            entries.append({'role':p.name,'path':p.name,'bytes':pin['bytes'],'sha256':pin['sha256']})
        except (ValueError,OSError) as e:
            errors.append({'role':p.name,'error':type(e).__name__});raise
    require((root.lstat().st_dev,root.lstat().st_ino)==(before.st_dev,before.st_ino),'inventory root drift')
    missing=[name for name in ('source-context.json','renderer-resource-growth-command.json','zk682-capture-phase-ledger.json') if name not in [x['role'] for x in entries]]
    return {'schemaVersion':1,'kind':'capture-phase-role-inventory','entries':entries,'fileCountIncludingInventory':len(entries)+1,'rawBytesExcludingInventory':total,'rawCapBytes':1073741824,'fileCountCap':128,'missingRequiredDiagnosticRoles':missing,'diagnosticReady':False,'capturePASS':False,'numericalPASS':False,'releaseCleared':False,'processClosure':'UNKNOWN; GNU timeout group envelope does not prove universal descendant/native closure'}


def read_state(root):
    return strict_json(file_bytes(root/'phase-intent.json',32768)[0],32768)


def init(driver,target,root,env):
    root=Path(root);root.mkdir(parents=False,exist_ok=False);canonical(root)
    state={'schemaVersion':1,'kind':'capture-phase-exclusive-intent','runtimePermission':'SEPARATE_ROOT_REGISTRATION_REQUIRED','roles':{},'firstFailurePresent':False,'firstFailure':None,'sourceQualified':False,'certificationEligible':False,'releaseCleared':False}
    try:
        state['roles']=roles(env);state['driverPins']=driver_guard(driver,state['roles']['driver_sha'])
        proof=source_guard(target,CANDIDATE,PINS);wx(root/'source-before.json',proof)
        require(proof['ok'],'initial target source failed');state['sourceQualified']=True
    except BaseException as e:
        first_failure(state,'initial-before',type(e).__name__);raise
    finally:wx(root/'phase-intent.json',state)


def prepare(driver,target,root):
    state=read_state(root);require(not state['firstFailurePresent'],'initial source failure')
    driver_guard(driver,state['roles']['driver_sha'])
    proof=source_guard(target,CANDIDATE,PINS);wx(root/'source-preproducer.json',proof)
    require(proof['ok'],'strict post-build tracked guard failed; no producer permitted')
    for relative,pin in IMPORTS.items():
        _,actual=file_bytes(target/relative,65536);require({k:actual[k] for k in ('bytes','sha256')}==pin,'unchanged producer import resolution')
    owned=project_copies(driver,target);wx(root/'projection-proof.json',{'schemaVersion':1,'fourFullInverse':True,'owned':owned})
    require(source_guard(target,CANDIDATE,PINS,owned)['ok'],'preproducer projection/source drift')
    sdk=sdk_binding(target);wx(root/'sdk-binding.json',sdk,65536)



def ready(driver,target,root):
    state=read_state(root);driver_guard(driver,state['roles']['driver_sha'])
    owned=strict_json(file_bytes(root/'projection-proof.json',32768)[0])['owned']
    proof=source_guard(target,CANDIDATE,PINS,owned);wx(root/'projection-before-producer.json',proof)
    require(proof['ok'],'strict final before-producer source/ownership drift')
    text=file_bytes(root/'discovery.log',262144)[0].decode('utf-8',errors='strict')
    lines=[line for line in text.splitlines() if 'zk1262-capture-phase-diagnostic.e2e.ts:' in line]
    require(len(lines)==1 and re.search(r'^Total: 1 test in 1 file\s*$',text,re.M),'exact one browser-free discovery')


def admit(root,value,owned,env):
    data,p=file_bytes(root/'inventory.json',65536)
    require(strict_json(data)==value and (p['dev'],p['ino'])==owned,'current owned inventory')
    r=roles(env);require(value['publicationRoles']==r and value['kind']=='capture-phase-role-inventory','current publication roles')
    fields={'inventory_bytes':p['bytes'],'inventory_sha256':p['sha256'],'inventory_dev':p['dev'],'inventory_ino':p['ino'],'inventory_driver':r['driver_sha'],'inventory_run':r['run_id'],'inventory_attempt':r['run_attempt']}
    if env.get('GITHUB_OUTPUT'):
        fd=os.open(canonical(Path(env['GITHUB_OUTPUT'])),os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
        try:
            q=os.fstat(fd);require(stat.S_ISREG(q.st_mode) and q.st_size==0,'fresh action output')
            b=(''.join(f'{k}={v}\n' for k,v in fields.items())+'inventory_ready=true\n').encode();require(os.write(fd,b)==len(b),'admission output write')
        finally:os.close(fd)
    return fields


def finalize(driver,target,root,env):
    # Neutral publication never clears failure.
    if not root.exists():root.mkdir(parents=False,exist_ok=False)
    canonical(root)
    intent_missing=False
    try:state=read_state(root)
    except (ValueError,OSError):
        state={'roles':{},'firstFailurePresent':False,'firstFailure':None,'sourceQualified':False}
        intent_missing=True
    try:
        if not state.get('roles'):state['roles']=roles(env)
    except (ValueError,OSError):first_failure(state,'roles','INVALID')
    steps={k:env.get('OUTCOME_'+k,'UNKNOWN') for k in ('CHECKOUT_DRIVER','CHECKOUT_TARGET','SETUP_NODE','INITIAL','INSTALL','BROWSER_INSTALL','BUILD','PREPARE','DISCOVERY','PRODUCER')}
    for k,v in steps.items():
        if v not in ('success','skipped','UNKNOWN'):first_failure(state,k,v)
    if intent_missing:first_failure(state,'initial-intent','MISSING_OR_INVALID')
    owned=None
    try:owned=strict_json(file_bytes(root/'projection-proof.json',32768)[0])['owned']
    except (ValueError,OSError,KeyError):pass
    try:
        after=source_guard(target,CANDIDATE,PINS,owned,post=True)
        if not after['ok']:first_failure(state,'source-after','TRACKED_OR_PIN_DRIFT')
        if state.get('roles'):driver_guard(driver,state['roles']['driver_sha'])
    except (ValueError,OSError,subprocess.SubprocessError) as e:
        after={'ok':False,'qualification':'Source status unavailable','error':type(e).__name__};first_failure(state,'source-after',type(e).__name__)
    wx(root/'source-after.json',after)
    inspected=None;receipt_pin=None;ledger_pin=None;sdk=None
    try:
        data,pin=file_bytes(root/'renderer-resource-growth-command.json',65536);inspected=receipt(data,target)
        receipt_pin={'path':str(root/'renderer-resource-growth-command.json'),**{k:pin[k] for k in ('bytes','sha256')}}
        if not inspected['passed']:first_failure(state,'producer-command','NONZERO_CANONICAL_RECEIPT')
    except (ValueError,OSError,subprocess.SubprocessError):first_failure(state,'receipt','MISSING_OR_INVALID')
    try:
        data,pin=file_bytes(root/'zk682-capture-phase-ledger.json',8192);strict_json(data,8192)
        ledger_pin={'path':str(root/'zk682-capture-phase-ledger.json'),**{k:pin[k] for k in ('bytes','sha256')}}
    except (ValueError,OSError):first_failure(state,'ledger','MISSING_OR_INVALID')
    try:
        sdk=strict_json(file_bytes(root/'sdk-binding.json',65536)[0])
        report=strict_json(file_bytes(root/'renderer-resource-growth.json',1048576)[0],1048576)
        actual_version=report['browser']['version'];require(actual_version=='149.0.7827.55','original report browser version')
        sdk['browserVersion']=actual_version;sdk['actualVersionQualification']='Measured original report page.context().browser().version()'
    except (ValueError,OSError,KeyError,TypeError):first_failure(state,'actual-version','MISSING_OR_INVALID')
    context={'schemaVersion':1,'kind':'capture-phase-hosted-neutral-context',**state.get('roles',{}),'sourcePins':PINS,'projectionPins':TOOLS,'driverPins':state.get('driverPins'),'sdk':sdk,
             'sourceBeforeQualified':state.get('sourceQualified',False),'sourceAfterQualified':after['ok'],'steps':steps,'canonicalReceiptInspection':inspected,'commandReceiptPin':receipt_pin,'ledgerPin':ledger_pin,
             'firstFailurePresent':state['firstFailurePresent'],'firstFailure':state['firstFailure'],'diagnosticReady':False,'trustedStageBContextReady':False,'capturePASS':False,'numericalPASS':False,'releaseCleared':False,
             'qualification':'ROOT independent StageB reader and fresh accepted actual context required. A valid nonzero canonical receipt is diagnostic failure, not invalid evidence. No late or native closure inferred.'}
    wx(root/'source-context.json',context,65536)
    wx(root/'setup-status.json',{'steps':steps,'firstFailurePresent':state['firstFailurePresent'],'firstFailure':state['firstFailure'],'strictBeforeProducerRequired':True})
    status={'producerStepOutcome':steps['PRODUCER'],'canonicalReceiptValid':inspected is not None,'commandOutcome':'UNKNOWN' if inspected is None else ('SUCCESS' if inspected['passed'] else 'FAILURE'),'capturePASS':False,'processClosure':'UNKNOWN'}
    wx(root/'producer-status.json',status)
    result=inventory(root);result.update({'sourceQualified':bool(state.get('sourceQualified')) and after['ok'],'wholeRunFailed':state['firstFailurePresent'],'firstFailure':state['firstFailure']})
    result['publicationRoles']=roles(env)
    admit(root,result,wx(root/'inventory.json',result,65536),env)
    return not state['firstFailurePresent']


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['init','prepare','ready','finalize','verdict']);a=p.parse_args()
    driver=Path(os.environ['CAPTURE_DRIVER_ROOT']);target=Path(os.environ['CAPTURE_TARGET_ROOT']);root=Path(os.environ['CAPTURE_ARTIFACT_ROOT'])
    if a.action=='init':init(driver,target,root,os.environ)
    elif a.action=='prepare':prepare(driver,target,root)
    elif a.action=='ready':ready(driver,target,root)
    elif a.action=='verdict':
        value=strict_json(file_bytes(root/'inventory.json',65536)[0]);require(value.get('wholeRunFailed') is False and value.get('sourceQualified') is True,'whole run failed; partial diagnostic only')
    else:return 0 if __import__('zk1262-build-capture-audit-owner').finalize(globals(),driver,target,root,os.environ) else 1
    return 0

if __name__=='__main__':raise SystemExit(main())
