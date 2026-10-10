"""Inert SAVE context producer. ROOT descriptor and separate once admission required.
No browser, owner, download, archive, snapshot or consumer activation occurs here.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

CAP = 32768
SOURCE_CAP = 65536
MAX_BINARY = 536870912
MAX_BINARY_TOTAL = 1073741824
MAX_STDIO = 262144
QUALIFICATION = 'SOURCE_QUALIFIED_LIVE_HOST_INSPECTOR_NOT_ROOT_PHYSICAL_OBSERVATION'
AUTHORITY = 'ROOT_REGISTERED_SAVE_ONCE_DESCRIPTOR_V1'
ADMISSION = 'ROOT_SEPARATELY_REGISTERED_SAVE_ONCE'
CANDIDATE = 'b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025'
BRANCH = 'codex/save-final-owner-b7fe'
WORKFLOW = '.github/workflows/zk1262-save-final-owner.yml'
CONTEXT = 'scripts/zk1262-save-context.py'
ROLES = ('initial-context.json', 'final-context.json', 'context-handoff.json')
FIXED = {'repository':'zkutty/golf-course-simulator-game','repositoryId':1120131901,
 'candidate':CANDIDATE,'workflow':WORKFLOW,'job':'save-final-owner',
 'mode':'save-final-owner-b7fe','event':'workflow_dispatch','attempt':1,'sourceBranch':BRANCH}
COMPONENTS = {'driver':'scripts/zk1262-save-final-driver.py',
 'phase':'scripts/zk1262-save-phase-adapter.py','typed':'scripts/zk1262-save-typed-adapter.py',
 'normalizer':'scripts/zk1262-build-audit-normalization.py',
 'stabilityContract':'simgolf-lite/scripts/zk682-stability-contract.mjs'}
KNOWN = {
 COMPONENTS['driver']:(29983,'23c3d5e8e4bd2a81f3beb69a6e8d3f0580effd9e2e96fa90c69ba6b930411a0b'),
 COMPONENTS['phase']:(24432,'74e475795537a49dafe054d2b345061dfa548731bdd3f9fba88e8b41485d60e8'),
 COMPONENTS['typed']:(26432,'88b7db38efa3692c972ca7fc9a8b12b1dfbf6fafc4559f30c51089543b3bc3f8'),
 COMPONENTS['normalizer']:(17794,'75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'),
 COMPONENTS['stabilityContract']:(25593,'16f4a1006eb9a7dcbe576ec0e2e7c4c6a73db49e8d8b91161c7ebed48b6a10b7'),
 'simgolf-lite/e2e/zk1262-save-final-owner-diagnostic.e2e.ts':(18463,'5a78fd068355f9631de5cf85df886ae4ee3e6ae9251422c7e3bfe8876b1e0216'),
 'simgolf-lite/scripts/zk1262-run-save-final-owner-diagnostic.mjs':(1809,'2cb3dee0d204cbce1cc7ef1356323662ad0fcb83940292d7c726a744288d0095'),
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs':(17547,'917c4dcc17cce4714dc20008fdd845d9948df1eecd2ffd53ada5f14bc998bf54'),
 'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.d.mts':(932,'68ac78feee2b9bc48b2ece2f9f9f78c89e2ad47f46a8bf8f28afde61a9ca45c6')}
DONORS = {'producer':(18463,'5a78fd068355f9631de5cf85df886ae4ee3e6ae9251422c7e3bfe8876b1e0216'),
 'originalProducer':(17333,'c45b0cf36a725fbe4da0de4877cdac016e29c334f63f1a3b674edfb20bdd2a45'),
 'collector':(17547,'917c4dcc17cce4714dc20008fdd845d9948df1eecd2ffd53ada5f14bc998bf54'),
 'declaration':(932,'68ac78feee2b9bc48b2ece2f9f9f78c89e2ad47f46a8bf8f28afde61a9ca45c6'),
 'runner':(1790,'43587e0f25cba83c3fe0f16884a91e291cf7bce7e813bd5c9a9805e038393647')}
POLICY = {'nodeMajor':22,'wallSeconds':120,'perCommandSeconds':30,'perJSON':65536,
 'perBinary':MAX_BINARY,'aggregateBinary':MAX_BINARY_TOTAL,'stdio':MAX_STDIO,'streamChunk':65536}
SDK = {'playwrightVersion':'1.61.1','revision':'1228','platform':'linux','arch':'x64',
 'browserName':'chromium'}

class Refusal(RuntimeError):
    pass

def need(value, message):
    if not value: raise Refusal(message)

def same(a, b):
    if type(a) is not type(b): return False
    if type(a) is dict: return a.keys()==b.keys() and all(same(a[k],b[k]) for k in a)
    if type(a) is list: return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))
    return a==b

def sha(raw): return hashlib.sha256(raw).hexdigest()

def encode(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()

def strict(raw, cap=SOURCE_CAP):
    need(type(raw) is bytes and len(raw)<=cap,'JSON byte cap')
    def pairs(rows):
        out={}
        for key,value in rows:
            need(key not in out,'duplicate JSON key');out[key]=value
        return out
    def bad(_): raise Refusal('nonfinite JSON')
    out=json.loads(raw.decode('utf8','strict'),object_pairs_hook=pairs,parse_constant=bad)
    def walk(value, depth=0):
        need(depth<=32,'JSON depth')
        if type(value) is float: need(math.isfinite(value),'finite JSON number')
        if type(value) is dict:
            need(len(value)<=256,'JSON object width')
            for child in value.values(): walk(child,depth+1)
        if type(value) is list:
            need(len(value)<=512,'JSON array width')
            for child in value: walk(child,depth+1)
    walk(out);return out

def hex_string(value, size):
    return type(value) is str and re.fullmatch('[0-9a-f]{'+str(size)+'}',value) is not None

def pin(value, cap=SOURCE_CAP, physical=False):
    keys={'bytes','sha256'}|({'dev','ino'} if physical else set())
    need(type(value) is dict and set(value)==keys,'pin exact fields')
    need(type(value['bytes']) is int and 0<value['bytes']<=cap and hex_string(value['sha256'],64),'pin types/cap')
    if physical: need(all(type(value[k]) is int and value[k]>=0 for k in ('dev','ino')),'pin physical types')
    return value

def logical_pin(pair): return {'bytes':pair[0],'sha256':pair[1]}

def relative(value):
    need(type(value) is str and len(value)<=256 and not value.startswith('/')
      and all(x not in ('','.','..') for x in value.split('/')),'relative source path')
    return value

def decimal(value):
    need(type(value) is str and re.fullmatch('[1-9][0-9]{0,15}',value) is not None,'strict decimal')
    result=int(value);need(result<=9007199254740991,'safe integer');return result

def descriptor(value):
    keys={'schema','authority','identityFixed','sourceSHA','sourceBranch','sourcePins','componentPaths',
      'contextModuleRelative','driverRoot','targetRoot','artifactRoot','contextRoot','projectionDonors',
      'normalizerRelative','runtimeAdmission','sdkExpected','hostInspectorPolicy'}
    need(type(value) is dict and set(value)==keys,'descriptor exact fields')
    need(type(value['schema']) is int and value['schema']==1 and value['authority']==AUTHORITY,'ROOT descriptor authority')
    need(same(value['identityFixed'],FIXED),'descriptor fixed identity')
    need(hex_string(value['sourceSHA'],40) and value['sourceSHA']!=CANDIDATE
      and value['sourceBranch']==BRANCH,'actual distinct immutable source')
    need(value['runtimeAdmission']==ADMISSION,'separate ROOT once admission')
    need(same(value['componentPaths'],COMPONENTS) and value['contextModuleRelative']==CONTEXT
      and value['normalizerRelative']==COMPONENTS['normalizer'],'exact component maps')
    need(same(value['sdkExpected'],SDK) and same(value['hostInspectorPolicy'],POLICY),'SDK/Node22 fixed inspector policy')
    sources=value['sourcePins'];need(type(sources) is dict and 8<=len(sources)<=32,'source count')
    for key,item in sources.items(): relative(key);pin(item)
    need(set(KNOWN)|{WORKFLOW,CONTEXT}<=set(sources),'mandatory source bindings')
    for key,item in KNOWN.items(): need(same(sources[key],logical_pin(item)),'known source: '+key)
    need(type(value['projectionDonors']) is dict and set(value['projectionDonors'])==set(DONORS),'five donor maps')
    root=Path(value['driverRoot'])
    for key,path in value['projectionDonors'].items():
        need(type(path) is str,'donor path type')
        try: rel=str(Path(path).relative_to(root))
        except ValueError: raise Refusal('donor outside immutable driver')
        relative(rel);need(same(sources.get(rel),logical_pin(DONORS[key])),'authentic committed donor: '+key)
    for key in ('driverRoot','targetRoot','artifactRoot','contextRoot'):
        need(type(value[key]) is str and len(value[key])<=4096 and Path(value[key]).is_absolute()
          and str(Path(value[key]))==value[key],'absolute descriptor root')
    return value

def environment_identity(d, env):
    required={'GITHUB_REPOSITORY':FIXED['repository'],'GITHUB_REPOSITORY_ID':str(FIXED['repositoryId']),
      'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/'+BRANCH,'GITHUB_JOB':'save-final-owner',
      'GITHUB_RUN_ATTEMPT':'1','GITHUB_SHA':d['sourceSHA'],
      'GITHUB_WORKFLOW_REF':FIXED['repository']+'/'+WORKFLOW+'@refs/heads/'+BRANCH}
    for key,value in required.items(): need(type(env.get(key)) is str and env.get(key)==value,'actual env: '+key)
    need(decimal(env['GITHUB_REPOSITORY_ID'])==1120131901 and decimal(env['GITHUB_RUN_ATTEMPT'])==1,'numeric env identity')
    run=decimal(env.get('GITHUB_RUN_ID'))
    need('NODE_OPTIONS' not in env and 'NODE_PATH' not in env,'Node hooks must be absent')
    need(type(env.get('PATH')) is str and 0<len(env['PATH'])<=32768,'actual PATH')
    browser_path=env.get('PLAYWRIGHT_BROWSERS_PATH','')
    need(type(browser_path) is str and len(browser_path)<=4096,'actual browser PATH')
    return {'repositoryId':1120131901,'candidate':CANDIDATE,'driver':d['sourceSHA'],'run':run,
      'attempt':1,'workflow':WORKFLOW,'job':'save-final-owner','mode':'save-final-owner-b7fe'}

def canonical(path, directory=False):
    p=Path(path);need(p.is_absolute() and str(p)==os.path.realpath(p),'canonical path')
    s=p.lstat()
    need(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode),'canonical type')
    return p

def physical(path):
    s=Path(path).lstat();return {'dev':s.st_dev,'ino':s.st_ino}

class Inspector:
    """One deadline; injected clock/runner controls do not establish live facts."""
    def __init__(self, clock=time.monotonic):
        self.clock=clock;self.start=clock();self.end=self.start+120;self.binary=0;self.stdio=0
        self.commands=[]
    def check(self): need(self.clock()<self.end,'inspector absolute deadline')
    def run(self, argv, cwd=None, env=None):
        self.check();deadline=min(self.end,self.clock()+30);process=None;selector=selectors.DefaultSelector()
        output=[bytearray(),bytearray()];failure=None
        try:
            process=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,
              stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            for i,stream in enumerate((process.stdout,process.stderr)): selector.register(stream,selectors.EVENT_READ,i)
            while selector.get_map() or process.poll() is None:
                need(self.clock()<deadline,'inspector command deadline')
                for key,_ in selector.select(min(.05,max(0,deadline-self.clock()))):
                    data=os.read(key.fileobj.fileno(),4096)
                    if not data: selector.unregister(key.fileobj);continue
                    self.stdio+=len(data);need(self.stdio<=MAX_STDIO,'inspector aggregate stdio')
                    need(len(output[key.data])+len(data)<=SOURCE_CAP,'inspector response cap')
                    output[key.data].extend(data)
            code=process.wait(timeout=max(0,deadline-self.clock()))
            need(self.clock()<deadline and self.clock()<self.end,'inspector late completed response')
            need(type(code) is int and code==0,'inspector child failure')
            self.commands.append({'argv':list(argv),'exitCode':code,'observedDirectChildReaped':True,
              'nativeDescendants':'UNKNOWN'});return bytes(output[0])
        except BaseException as error:
            failure=error;raise
        finally:
            selector.close()
            if process is not None:
                if process.poll() is None:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except (ProcessLookupError,PermissionError): pass
                    remaining=max(0,min(deadline,self.end)-self.clock())
                    if remaining>0:
                        try: process.wait(timeout=remaining)
                        except subprocess.TimeoutExpired: pass
                for stream in (process.stdout,process.stderr):
                    if stream is not None:
                        try: stream.close()
                        except BaseException:
                            if failure is None: raise
                if process.poll() is None and failure is None: raise Refusal('inspector reap unobserved')
    def read(self, path, cap=SOURCE_CAP, opaque=False):
        self.check();p=Path(path);canonical(p.parent,True)
        captured=physical(p.parent);parentfd=None;fd=None;primary=None
        def parent_guard():
            self.check();canonical(p.parent,True);s=os.fstat(parentfd)
            need(stat.S_ISDIR(s.st_mode) and captured==physical(p.parent)==
              {'dev':s.st_dev,'ino':s.st_ino},'read parent drift')
        def state(s):
            return (s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        def regular(s):
            need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and 0<s.st_size<=cap,
              'regular single-link read cap')
        try:
            parentfd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            parent_guard()
            before=os.stat(p.name,dir_fd=parentfd,follow_symlinks=False);regular(before)
            # NONBLOCK closes the regular-to-FIFO replacement race; precheck
            # alone is insufficient. The same retained parent owns both opens.
            fd=os.open(p.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parentfd)
            a=os.fstat(fd);regular(a);parent_guard()
            located=os.stat(p.name,dir_fd=parentfd,follow_symlinks=False)
            need(state(before)==state(a)==state(located),'preopen/open/path read identity')
            h=hashlib.sha256();data=bytearray();n=0
            while True:
                self.check();block=os.read(fd,min(65536,cap-n+1))
                if not block: break
                n+=len(block);need(n<=cap,'stream cap');h.update(block)
                if opaque:
                    self.binary+=len(block);need(self.binary<=MAX_BINARY_TOTAL,'aggregate binary cap')
                else: data.extend(block)
            parent_guard();b=os.fstat(fd);regular(b)
            located=os.stat(p.name,dir_fd=parentfd,follow_symlinks=False);regular(located)
            need(state(a)==state(b)==state(located),'stable stream read')
            need(n==a.st_size,'read completeness/location')
            parent_guard();self.check()
            return bytes(data),{'bytes':n,'sha256':h.hexdigest(),'dev':a.st_dev,'ino':a.st_ino}
        except BaseException as error:
            primary=error;raise
        finally:
            close_error=None
            for owned in (fd,parentfd):
                if owned is not None:
                    try: os.close(owned)
                    except BaseException as error:
                        if close_error is None: close_error=error
            if primary is None and close_error is not None: raise close_error

class PrivateRoot:
    def __init__(self, path, inspect):
        self.inspect=inspect;self.path=Path(path);self.fd=None;self.parentfd=None;self.owned={}
        canonical(self.path.parent,True);self.parent=physical(self.path.parent)
        self.parentfd=os.open(self.path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            self.check_parent();os.mkdir(self.path.name,0o700,dir_fd=self.parentfd)
            self.fd=os.open(self.path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=self.parentfd)
            self.identity={'dev':os.fstat(self.fd).st_dev,'ino':os.fstat(self.fd).st_ino}
            self.guard();os.fsync(self.parentfd)
        except BaseException:
            self.close();raise
    def check_parent(self):
        self.inspect.check();s=os.fstat(self.parentfd)
        need(physical(self.path.parent)==self.parent=={'dev':s.st_dev,'ino':s.st_ino},'context parent drift')
    def guard(self):
        self.check_parent();s=os.fstat(self.fd)
        need(physical(self.path)==self.identity=={'dev':s.st_dev,'ino':s.st_ino},'context root drift')
        need(stat.S_IMODE(s.st_mode)==0o700,'private context root')
        need(set(os.listdir(self.fd))==set(self.owned),'context extra roles')
    def wx(self, role, value):
        need(role in ROLES and role not in self.owned,'registered wx role')
        self.guard();raw=encode(value);need(len(raw)<=CAP,'context publication cap')
        fd=os.open(role,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=self.fd)
        try:
            a=os.fstat(fd);need(stat.S_ISREG(a.st_mode) and a.st_nlink==1,'wx physical type')
            n=0
            while n<len(raw):
                self.inspect.check();w=os.write(fd,raw[n:]);need(w>0,'wx short write');n+=w
            os.fsync(fd);self.inspect.check()
            need(os.pread(fd,CAP+1,0)==raw,'wx readback bytes')
            observed=os.stat(role,dir_fd=self.fd,follow_symlinks=False)
            need((observed.st_dev,observed.st_ino)==(a.st_dev,a.st_ino) and observed.st_nlink==1,'wx readback identity')
            pin_value={'bytes':len(raw),'sha256':sha(raw),'dev':a.st_dev,'ino':a.st_ino}
            self.owned[role]=pin_value;os.fsync(self.fd);self.guard()
            actual_raw,actual=self.inspect.read(self.path/role,CAP)
            need(actual_raw==raw and same(actual,pin_value),'wx stable full readback')
            return pin_value
        finally: os.close(fd)
    def close(self):
        for key in ('fd','parentfd'):
            fd=getattr(self,key,None)
            if fd is not None: os.close(fd);setattr(self,key,None)

def code_load(raw, path, expected, name):
    need(same({'bytes':len(raw),'sha256':sha(raw)},expected),'hash before module execution')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    try: exec(compile(raw,str(path),'exec'),module.__dict__)
    except BaseException:
        sys.modules.pop(name,None);raise
    return module

def source_inspect(d, inspector):
    for key in ('driverRoot','targetRoot'): canonical(d[key],True)
    need(d['driverRoot']!=d['targetRoot'],'separate source/target')
    for root,expected in ((d['driverRoot'],d['sourceSHA']),(d['targetRoot'],CANDIDATE)):
        actual=inspector.run(['git','--no-optional-locks','-C',root,'rev-parse','--verify','HEAD'])
        need(actual==expected.encode()+b'\n','actual Git HEAD')
    codes={}
    for rel,expected in d['sourcePins'].items():
        raw,actual=inspector.read(Path(d['driverRoot'])/rel)
        need(same({k:actual[k] for k in ('bytes','sha256')},expected),'actual source pin: '+rel)
        committed=inspector.run(['git','--no-optional-locks','-C',d['driverRoot'],'show',d['sourceSHA']+':'+rel])
        need(raw==committed,'actual committed source: '+rel)
        if rel in (CONTEXT,COMPONENTS['phase'],COMPONENTS['driver']): codes[rel]=raw
    self_path=Path(__file__).resolve()
    need(self_path==Path(d['driverRoot'])/CONTEXT,'own context module path')
    own,_=inspector.read(self_path);need(own==codes[CONTEXT],'own executed source bytes')
    return codes

def roots_check(d):
    for key in ('artifactRoot','contextRoot'):
        p=Path(d[key]);canonical(p.parent,True)
        need(not p.exists() and not p.is_symlink(),'fresh root: '+key)
        need(str(p)==os.path.realpath(p),'future canonical root')
    context=Path(d['contextRoot'])
    for path in (d['artifactRoot'],d['artifactRoot']+'-external',d['artifactRoot']+'-audit-owner',d['driverRoot'],d['targetRoot']):
        other=Path(path)
        need(context!=other and other not in context.parents and context not in other.parents,'disjoint context root')
    need(not Path(d['artifactRoot']+'-external').exists() and not Path(d['artifactRoot']+'-external').is_symlink(),'fresh external root')

def marker_verify(p, driver, ctx, seal_result, inspector):
    need(type(seal_result) is dict and set(seal_result)=={'boundary','marker','qualification'},'actual seal result')
    expected=pin(seal_result['boundary'],CAP,True)
    path=Path(ctx['artifactRoot']+'-external')/p.EXTERNAL[0]
    raw,actual=inspector.read(path,CAP)
    need(same(actual,expected) and same(strict(raw,CAP),seal_result['marker']),'actual returned marker stable readback')
    final={**ctx,'prelaunchBoundaryPin':expected}
    marker,observed,_=driver.live_boundary(p,final)
    need(same(marker,seal_result['marker']) and same(observed,expected),'unchanged live boundary')
    inspector.check();need(inspector.clock()<marker['start']+p.TERM,'original TERM consumed, never restarted')
    return final,expected,marker

def cache_path(env):
    need(all(key=='PLAYWRIGHT_BROWSERS_PATH' or not key.lower().endswith('playwright_browsers_path')
      for key in env),'alternate browser cache environment refused')
    supplied=env.get('PLAYWRIGHT_BROWSERS_PATH','')
    need(supplied!='0','in-package browser override refused')
    if supplied:
        return canonical(supplied,True)
    home=env.get('HOME');need(type(home) is str and home,'actual HOME for default cache')
    canonical(home,True)
    base=env.get('XDG_CACHE_HOME','') or str(Path(home)/'.cache')
    canonical(base,True)
    return canonical(Path(base)/'ms-playwright',True)

def host_inspect(d, env, inspector):
    # Locked 1.61.1 coreBundle literal selects default headless shell, not
    # chromium.executablePath(). No SDK import, private call or browser launch.
    need(sys.platform=='linux' and os.uname().machine=='x86_64','Linux x64 host only')
    node=shutil.which('node',path=env['PATH']);need(node is not None,'default Node present')
    node=str(Path(node).resolve());canonical(node)
    version=inspector.run([node,'--version'],env=env)
    need(re.fullmatch(b'v22\.[0-9]+\.[0-9]+\n',version) is not None,'actual default Node22')
    _,np=inspector.read(node,MAX_BINARY,True)
    sdk_files={};packages=Path(d['targetRoot'])/'simgolf-lite/node_modules'
    for name in ('@playwright/test','playwright','playwright-core'):
        path=packages/name/'package.json';canonical(path)
        raw,actual=inspector.read(path)
        pkg=strict(raw);need(pkg.get('name')==name and pkg.get('version')=='1.61.1','locked SDK package')
        sdk_files[str(path)]={k:actual[k] for k in ('bytes','sha256')}
    core=packages/'playwright-core'
    need(same(sdk_files[str(core/'package.json')],logical_pin((876,
      '759e376f995bf39edd4810d699b99469bab1d7428b6fbc78d41912f367df7ba9'))),'locked core package bytes')
    raw,rp=inspector.read(core/'browsers.json')
    need(same({k:rp[k] for k in ('bytes','sha256')},logical_pin((1939,
      'ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942'))),'locked registry bytes')
    registry=strict(raw);rows=registry.get('browsers')
    need(type(rows) is list and len(rows)<=32,'registry schema')
    candidates=[x for x in rows if type(x) is dict and x.get('name')=='chromium-headless-shell']
    need(len(candidates)==1,'unique locked headless descriptor')
    selected=candidates[0]
    need(selected.get('revision')=='1228' and selected.get('installByDefault') is True
      and selected.get('browserVersion')=='149.0.7827.55' and not selected.get('revisionOverrides'),
      'exact default revision/no overrides')
    sdk_files[str(core/'browsers.json')]={k:rp[k] for k in ('bytes','sha256')}
    _,bundle=inspector.read(core/'lib/coreBundle.js',MAX_BINARY,True)
    need(same({k:bundle[k] for k in ('bytes','sha256')},logical_pin((3352341,
      '6be5c2ea035554e9b184b1dbc7aa5e7f1fb428dd1b5c202022858dcfae9bee27'))),'locked default selector bundle')
    sdk_files[str(core/'lib/coreBundle.js')]={k:bundle[k] for k in ('bytes','sha256')}
    cache=cache_path(env)
    executable=cache/'chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell'
    canonical(executable);_,bp=inspector.read(executable,MAX_BINARY,True)
    sdk_files[str(executable)]={k:bp[k] for k in ('bytes','sha256')}
    inspector.check()
    return {'node':node,'nodePin':{k:np[k] for k in ('bytes','sha256')},'sdkFiles':sdk_files,
      'environmentExpected':{k:env.get(k,'') for k in ('PATH','PLAYWRIGHT_BROWSERS_PATH')},
      'facts':{'qualification':QUALIFICATION,'nodeVersion':version.decode().strip(),
        'platform':'linux','arch':'x64','defaultHeadless':True,'channel':'ABSENT',
        'executableOverride':'ABSENT','browserName':'chromium-headless-shell','revision':'1228',
        'browserDeclaredVersion':'149.0.7827.55','actualCacheRoot':str(cache),'actualExecutable':str(executable),
        'HOME':env['HOME'],'XDG_CACHE_HOME':env.get('XDG_CACHE_HOME',''),
        'NodePlatformArchitecture':'HOST_EXECUTION_COMPATIBILITY_ONLY_NOT_BINARY_ATTESTATION',
        'inspectorCommands':inspector.commands,'binaryBytes':inspector.binary,
        'aggregateStdioBytes':inspector.stdio,'nativeDescendants':'UNKNOWN'}}

def cause(error):
    if isinstance(error,Refusal) and len(error.args)==1 and type(error.args[0]) in (str,int,float,bool,type(None)):
        value=error.args[0]
        return value[:1024] if type(value) is str else value
    return {'type':type(error).__name__,'message':str(error)[:1024]}

def prepare(d, descriptor_sha, env, inspector, source_fn=source_inspect, host_fn=None,
            loader=code_load, root_factory=PrivateRoot):
    """No owner call exists. Seams are for explicit synthetic ROOT-only controls."""
    descriptor(d);identity=environment_identity(d,env);roots_check(d);inspector.check()
    codes=source_fn(d,inspector)
    need(host_fn is not None,'registered default selector required')
    host=host_fn(d,env,inspector)
    initial={'identity':identity,'sourcePins':d['sourcePins'],'componentPaths':d['componentPaths'],
      'node':host['node'],'nodePin':host['nodePin'],'targetRoot':d['targetRoot'],'driverRoot':d['driverRoot'],
      'artifactRoot':d['artifactRoot'],'normalizerRelative':d['normalizerRelative'],
      'projectionDonors':d['projectionDonors'],'sdkExpected':d['sdkExpected'],'sdkFiles':host['sdkFiles'],
      'environmentExpected':host['environmentExpected'],'runtimeAdmission':ADMISSION,'admissionSHA256':descriptor_sha}
    p=loader(codes[COMPONENTS['phase']],Path(d['driverRoot'])/COMPONENTS['phase'],d['sourcePins'][COMPONENTS['phase']],'save_context_phase')
    driver=loader(codes[COMPONENTS['driver']],Path(d['driverRoot'])/COMPONENTS['driver'],d['sourcePins'][COMPONENTS['driver']],'save_context_driver')
    p.identity(initial);root=root_factory(d['contextRoot'],inspector);primary=None
    try:
        ip=root.wx(ROLES[0],initial);inspector.check()
        result=p.seal(initial);inspector.check()
        final,bp,marker=marker_verify(p,driver,initial,result,inspector)
        need(set(final)==set(initial)|{'prelaunchBoundaryPin'} and same({k:final[k] for k in initial},initial),'final only-one-key addition')
        fp=root.wx(ROLES[1],final);inspector.check()
        driver.live_boundary(p,final)
        need(inspector.clock()<marker['start']+p.TERM,'late final original TERM')
        handoff={'schema':1,'kind':'SAVE_CONTEXT_SOURCE_QUALIFIED_HANDOFF_V1','identity':identity,
          'descriptorSHA256':descriptor_sha,'qualification':QUALIFICATION,
          'initial':{'path':str(root.path/ROLES[0]),**ip},'final':{'path':str(root.path/ROLES[1]),**fp},
          'seal':bp,'providerName':'zk1262-save-context-'+d['sourceSHA']+'-'+str(identity['run'])+'-1',
          'inspector':host['facts'],'contextRootIdentity':root.identity,
          'inspectorStartedMonotonic':inspector.start,'inspectorEndedMonotonic':inspector.clock(),
          'ownerLaunched':False,'nativeDescendants':'UNKNOWN','runtimeAcceptance':False}
        hp=root.wx(ROLES[2],handoff);root.guard();inspector.check()
        need(sum(x['bytes'] for x in root.owned.values())<=98304 and set(root.owned)==set(ROLES),'exact bounded handoff roles')
        return {'finalPath':str(root.path/ROLES[1]),'finalPin':fp,'handoffPin':hp,
          'qualification':QUALIFICATION,'ownerLaunched':False}
    except BaseException as error:
        primary=error;raise
    finally:
        try: root.close()
        except BaseException:
            if primary is None: raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--descriptor',required=True)
    parser.add_argument('--descriptor-sha256',required=True);args=parser.parse_args()
    inspector=Inspector()
    try:
        need(hex_string(args.descriptor_sha256,64),'explicit ROOT descriptor full SHA')
        raw,_=inspector.read(args.descriptor,SOURCE_CAP)
        need(sha(raw)==args.descriptor_sha256,'actual ROOT descriptor bytes')
        d=descriptor(strict(raw));result=prepare(d,args.descriptor_sha256,dict(os.environ),inspector,host_fn=host_inspect)
        print(encode(result).decode(),end='');return 0
    except BaseException as error:
        # Durable partial initial/marker remain. No false final or success handoff.
        print(encode({'eligible':False,'firstCausePresent':True,'firstCause':cause(error),
          'ownerLaunched':False,'qualification':QUALIFICATION}).decode(),file=sys.stderr,end='')
        return 2

if __name__=='__main__': sys.exit(main())
