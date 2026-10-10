"""SAVE typed intake: mandatory lifecycle AND independent deadlines AND both verdicts.
ROOT authenticated producer facts are external inputs. Current inode is intake-only.
No snapshot parsing or renderer/capture receipt substitution. Pure original numerics.
"""
import argparse
import base64
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

CONTRACT_SHA='16f4a1006eb9a7dcbe576ec0e2e7c4c6a73db49e8d8b91161c7ebed48b6a10b7'
NORMALIZER_SHA='75ffda7ac5d4849ce160c117c475edd7bdf86a211ce889b908b901b252eea8d0'
GATE='save-load-resource-stability'
REPORT_KEYS={'schemaVersion','gate','candidateCommit','capturedAt','command','browser','thresholds',
             'samples','observations','summary','errors','passed','legacyRawComparison'}
BASELINE={'bytes':7306,'sha256':'6d236fa40b3bfba6aa6714eb7c9b77eb2ee51eb264002deec5697c8a18568176'}
NODE_SCRIPT=r'''
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
const module=await import('data:text/javascript;base64,'+process.argv[1]);
const input=JSON.parse(readFileSync(0,'utf8'));
const thresholds=module.ZK682_STABILITY_THRESHOLDS['save-load-resource-stability'];
const computed=module.createZk682ConservationStabilityReport({...input,thresholds});
console.log(JSON.stringify({thresholds,observations:computed.observations,summary:computed.summary,
  errors:computed.errors,passed:computed.passed,legacyRawComparison:computed.legacyRawComparison}));
'''


def node_pure(p,ctx,input):
    path=ctx['stabilityContractPath'];raw,pin=p.file_bytes(path,65536)
    p.require(pin['bytes']==25593 and pin['sha256']==CONTRACT_SHA,'original pure stability source')
    p.require(ctx['sourcePins'][ctx['componentPaths']['stabilityContract']]=={'bytes':25593,'sha256':CONTRACT_SHA},'ROOT contract Git pin')
    actual=p.stream_pin(ctx['node'],ctx['nodePin']['bytes'])
    p.require({k:actual[k] for k in ('bytes','sha256')}==ctx['nodePin'],'externally bound Node actual bytes')
    payload=p.encoded(input);p.require(len(payload)<=65536,'numeric stdin cap')
    process=subprocess.Popen([ctx['node'],'--max-old-space-size=512','--input-type=module','-e',NODE_SCRIPT,base64.b64encode(raw).decode('ascii')],
      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
      env={'PATH':str(Path(ctx['node']).parent),'HOME':os.environ.get('HOME','/nonexistent')})
    start=time.monotonic();selection=selectors.DefaultSelector();output={'out':bytearray(),'err':bytearray()};total=0
    try:
        os.set_blocking(process.stdin.fileno(),False)
        selection.register(process.stdin,selectors.EVENT_WRITE,'in')
        selection.register(process.stdout,selectors.EVENT_READ,'out');selection.register(process.stderr,selectors.EVENT_READ,'err')
        position=0
        while selection.get_map():
            p.require(time.monotonic()-start<15,'pure numeric Node deadline')
            for key,_ in selection.select(0.05):
                if key.data=='in':
                    if position<len(payload):position+=os.write(key.fileobj.fileno(),payload[position:position+4096])
                    if position==len(payload):selection.unregister(key.fileobj);key.fileobj.close()
                else:
                    block=os.read(key.fileobj.fileno(),4096)
                    if not block:selection.unregister(key.fileobj);continue
                    total+=len(block);p.require(total<=65536,'pure numeric stdout/stderr cap');output[key.data].extend(block)
        p.require(process.wait(timeout=max(0.001,15-(time.monotonic()-start)))==0,'pure numeric original contract refusal: '+bytes(output['err']).decode('utf8','replace')[:1024])
        p.require(time.monotonic()-start<=15,'pure numeric late completion')
        return p.strict_json(bytes(output['out']),65536)
    finally:
        selection.close()
        if process.poll() is None:os.killpg(process.pid,signal.SIGKILL)
        process.wait(timeout=2)
        for pipe in (process.stdin,process.stdout,process.stderr):
            if not pipe.closed:pipe.close()


def numeric(p,report,ctx):
    p.require(type(report) is dict and set(report)==REPORT_KEYS and type(report['schemaVersion']) is int
      and report['schemaVersion']==3 and report['gate']==GATE and report['candidateCommit']==p.CANDIDATE,'original SAVE v3 identity/schema')
    p.require(type(report['capturedAt']) is str and type(report['command']) is str
      and report['command']=='npm run test:stability','original SAVE metadata')
    browser=report['browser'];p.require(type(browser) is dict and browser.get('name')=='chromium'
      and browser.get('cdpHeap') is True and type(browser.get('version')) is str and browser['version'],'original Chromium metadata')
    protocol=browser.get('heapMeasurementProtocol')
    p.require(p.equal(protocol,{'id':'settle-cleanup-gc-query-v1','settlementMs':120}),'original measurement protocol')
    rows=report['samples'];p.require(type(rows) is list and len(rows)==13,'exact original13 SAVE rows')
    for i,row in enumerate(rows):
        p.require(type(row) is dict and type(row.get('cycle')) is int and row['cycle']==i
          and row.get('slotId')=='quick-save' and type(row.get('loaded')) is bool and row['loaded']==(i>0),'SAVE cycle/restore types')
        p.require(type(row.get('resources')) is dict and row['resources'].get('canvasConnected') is True,'canvas ownership')
        heap=row.get('heap');p.require(type(heap) is dict and p.finite(heap.get('runtimeUsedBytes')) and heap['runtimeUsedBytes']>0,'heap type')
        for key in ('displayObjects','attachedTextures','attachedTextureSources','managedTextureSources'):
            p.require(p.finite(row['resources'].get(key)),'resource numeric type')
        p.require(type(row.get('rendererQuality')) is str and row['rendererQuality'] in ('high','medium','low'),'natural quality row')
        p.require(type(row['resources'].get('emoteOwnership')) is dict,'original conservation ownership facts')
    result=node_pure(p,ctx,{key:report[key] for key in ('gate','candidateCommit','capturedAt','command','browser','thresholds','samples')})
    p.require(p.equal(report['thresholds'],result['thresholds']),'immutable exact original thresholds')
    for key in ('observations','summary','errors','passed','legacyRawComparison'):
        p.require(p.equal(report[key],result[key]),'declared SAVE result differs from original raw recomputation: '+key)
    p.require(type(result['passed']) is bool and type(result['errors']) is list,'numeric result types')
    return {'numericalPASS':result['passed'],'originalErrors':result['errors'],
            'originalSummary':result['summary'],'legacyRawComparison':result['legacyRawComparison'],
            'qualification':'Unchanged original v3 SAVE13-row contract; snapshot after report'}


def audit_validate(p,audits,pins,ctx,terminal):
    p.require(set(audits)==set(pins),'audit bytes exact bound role set')
    required={'baseline-audit.json','before.json','generated-audit.json','generated.json','normalized.json','final.json'}
    p.require(required<=set(audits) and not any('failure' in k for k in audits),'successful audit evidence roles')
    for key,raw in audits.items():
        p.strict_json(raw,65536)
        p.require(key in p.AUDITS and len(raw)==pins[key]['bytes'] and p.digest(raw)==pins[key]['sha256'],'ROOT audit byte pins')
    p.require({k:pins['baseline-audit.json'][k] for k in ('bytes','sha256')}==BASELINE,'registered baseline bytes')
    docs={k:p.strict_json(raw,65536) for k,raw in audits.items() if not k.endswith('audit.json')}
    common_keys={'status','candidate','audit','statusNulBase64','statusBytes','statusSha256','statusComplete',
      'physical','directories','spent','restorationAttempted','normalized','failed','firstError'}
    for name,doc in docs.items():
        expected=common_keys|({'generatedBytes','generatedSha256','baselineBytes','baselineSha256'} if name=='generated.json' else set())
        p.require(set(doc)==expected,'exact immutable AuditOwner receipt schema')
    before=docs['before.json'];generated=docs['generated.json'];normalized=docs['normalized.json'];final=docs['final.json']
    p.require(before['status']=='BEFORE_CAPTURED' and before['spent'] is False and before['normalized'] is False,'AuditOwner before build')
    physical=before['physical'];directories=before['directories']
    source_paths={'simgolf-lite/artifacts/m35/asset-audit.json','simgolf-lite/package.json','simgolf-lite/playwright.config.ts',
      'simgolf-lite/e2e/zk682-resource-growth.e2e.ts','simgolf-lite/e2e/zk682-stability.e2e.ts',
      'simgolf-lite/scripts/zk682-run-resource-growth.mjs','simgolf-lite/scripts/zk682-run-stability.mjs',
      'simgolf-lite/scripts/m35-asset-audit.mjs'}
    p.require({row['path'] for row in physical}==source_paths,'exact registered protected/audit descriptor paths')
    p.require(type(physical) is list and len(physical)==8 and len({r['path'] for r in physical})==8,'eight audit/protected descriptors')
    p.require(all(type(row['dev']) is int and type(row['inode']) is int and row['mode']==420
      and row['nlink']==1 for row in physical),'audit descriptor types/links')
    for d in (before,generated,normalized,final):
        p.require(all(type(d[k]) is bool for k in ('spent','restorationAttempted','normalized','failed','statusComplete'))
          and type(d['statusBytes']) is int and d['statusBytes']>=0,'audit receipt boolean/integer types')
    for d in (before,generated,normalized,final):
        p.require(d['candidate']==p.CANDIDATE and d['audit']=='simgolf-lite/artifacts/m35/asset-audit.json'
          and d['statusComplete'] is True and d['failed'] is False and d['firstError'] is None
          and p.equal(d['physical'],physical) and p.equal(d['directories'],directories),'same retained AuditOwner physical/history')
    for d in (before,normalized,final):
        p.require(d['statusNulBase64']=='' and d['statusBytes']==0 and
          d['statusSha256']==p.digest(b''),'strict whole clean audit guard')
    p.require(generated['status']=='GENERATED_PRESERVED' and generated['spent'] is True
      and generated['generatedBytes']==len(audits['generated-audit.json'])
      and generated['generatedSha256']==p.digest(audits['generated-audit.json'])
      and generated['baselineBytes']==BASELINE['bytes'] and generated['baselineSha256']==BASELINE['sha256'],'preserved generated audit')
    restored=audits['generated-audit.json']!=audits['baseline-audit.json']
    status_bytes=(b' M simgolf-lite/artifacts/m35/asset-audit.json\0' if restored else b'')
    p.require(generated['statusNulBase64']==base64.b64encode(status_bytes).decode()
      and generated['statusBytes']==len(status_bytes) and generated['statusSha256']==p.digest(status_bytes)
      and generated['restorationAttempted'] is False and generated['normalized'] is False,'generated whole audit-only status and pre-restoration facts')
    p.require(normalized['status']==('BASELINE_RESTORED_ONCE' if restored else 'NOOP_BASELINE_CLEAN')
      and normalized['restorationAttempted'] is restored and normalized['normalized'] is True
      and normalized['spent'] is True,'normalize exactly once result')
    p.require(final['status']=='FINAL_STRICT_CLEAN' and final['normalized'] is True and final['spent'] is True
      and final['restorationAttempted'] is restored,'strict final no additional restore')
    evidence=terminal['audit']['evidence'];p.require(p.equal(evidence['files'],pins)
      and evidence['root']==ctx['artifactRoot']+'-audit-owner','terminal audit crossbinding')
    return True


def collector_validate(p,status,files,report,root_identity):
    p.require(status.get('schema')==1 and status.get('candidateCommit')==p.CANDIDATE
      and status.get('sampleCount')==13 and status.get('noncanonical') is True
      and status.get('snapshotPerturbsLaterStages') is True and status.get('canonicalCredit') is False
      and status.get('graphAccepted') is False,'collector original schema/qualification')
    p.require(p.equal(status.get('originalSaveErrors'),report['errors']),'collector retains original numeric errors')
    p.require(status.get('firstFailurePresent') is False and status.get('firstFailure') is None
      and status.get('cleanupFailures')==[] and status.get('durablePreclose') is True
      and status.get('completeTransportFile') is True and status.get('commandSettled') is True
      and status.get('commandResolved') is True and status.get('fsynced') is True,'collector failure/transport evidence')
    p.require(status.get('deadlineMs')==120000 and p.finite(status.get('completionAdmissionElapsedMs'))
      and status['completionAdmissionElapsedMs']<120000 and status.get('observedDeadlineExceeded') is False,'collector inside fixed120')
    p.require(status.get('nativeAbort')=='UNKNOWN' and status.get('nativeBackpressure')=='UNKNOWN'
      and status.get('transportBufferBound')=='UNKNOWN' and status.get('helperOwnsDetachOrClose') is False
      and status.get('closureReceiptRequired') is True and status.get('independentSchemaAdmissionRequired') is True,'no native/parser closure inference')
    raw=files['save-final-owner.heapsnapshot'];p.require('save-final-owner.heapsnapshot.part' not in files,'coexisting raw/part is held failure')
    p.require(type(status.get('bytesCharged')) is int and 0<status['bytesCharged']<=134217728
      and status['bytesCharged']==raw['bytes'] and status.get('streamedSHA256')==raw['sha256']
      and status.get('independentSHA256')==raw['sha256'],'collector full opaque byte/hash')
    p.require(type(status.get('elapsedMs')) is int and status['elapsedMs']==math.ceil(status['completionAdmissionElapsedMs'])
      and type(status.get('chunks')) is int and status['chunks']>0 and type(status.get('writes')) is int and status['writes']>0,'collector observed timing/counters')
    publication=status.get('publication')
    p.require(p.equal(publication,{'dev':str(raw['dev']),'ino':str(raw['ino']),'bytes':raw['bytes'],'nlink':1,
      'sha256':raw['sha256'],'parentDev':str(root_identity['dev']),'parentIno':str(root_identity['ino'])}),'collector publication physical crossbinding')
    p.require(type(status.get('decodedUtf16BytesCharged')) is int and 0<status['decodedUtf16BytesCharged']<=134217728,'collector delivered UTF16 cap')
    p.require(status.get('publicationMethod')=='registered-exclusive-hardlink-unlink'
      and status.get('publicationAmendmentSHA256')=='46b63243a78085ead78720766f1c5031ba0b75acb8bec82865f73d17916544f9'
      and status.get('downstream')=='MAY_CONTINUE_ORIGINAL_ORDER_SNAPSHOT_PERTURBED','collector admitted publication/ordering')
    return True


def consume(p,ctx,raws,external,audits,facts):
    """Pure archived interface. All facts/pins are authenticated outside these bytes.
    Replay now=max finite journal stamp is a synthetic bound, never actual-now proof.
    """
    out={'schema':1,'kind':'SAVE_TYPED_INTAKE_V1','identity':ctx['identity'],'trusted':False,
      'diagnosticReady':False,'capturePASS':False,'numericalPASS':False,'graphAccepted':False,
      'releaseCleared':False,'numericalOutcome':'UNKNOWN','originalErrors':[],'firstCausePresent':False,'firstCause':None,'secondary':[],
      'nativeChildClosure':'UNKNOWN','laterStages':'SNAPSHOT_PERTURBED_DIAGNOSTIC_ONLY',
      'replayClockQualification':'Synthetic max finite journal stamp; no actual-now or archived physical identity inference'}
    try:
        p.identity(ctx);p.require(set(external)==set(p.EXTERNAL),'all three exact external roles')
        p.require(set(raws)==set(facts['files']) and set(raws)<=set(p.ROLE_CAPS),'ROOT exact SAVE historical roles')
        for name,raw in raws.items():
            # Opaque values are pins only, not bytes and never parsed.
            if name in ('save-final-owner.heapsnapshot','save-final-owner.heapsnapshot.part'):
                p.require(p.equal(raw,facts['files'][name]),'opaque externally bound full pin')
            else:
                p.require(type(raw) is bytes and len(raw)<=p.ROLE_CAPS[name]
                  and len(raw)==facts['files'][name]['bytes'] and p.digest(raw)==facts['files'][name]['sha256'],'same job role bytes')
        journal=p.strict_json(raws['phase-journal.json']);receipt=p.strict_json(raws['save-actual-command-receipt.json'])
        terminal=journal['terminal']
        if terminal['firstCausePresent'] is True:
            out.update(firstCausePresent=True,firstCause=terminal['firstCause'],secondary=terminal['secondary'][:16])
        report=p.strict_json(raws['save-load-resource-stability.json'],65536)
        numerics=numeric(p,report,ctx);out.update(numerics)
        out['numericalOutcome']='PASS' if numerics['numericalPASS'] else 'FAIL'
        required=set(p.METADATA)|set(p.PRODUCER)|{'save-final-owner.heapsnapshot','save-final-owner.preclose.json'}
        p.require(required<=set(raws),'missing required SAVE artifact')
        marker=p.strict_json(external[p.EXTERNAL[0]])
        for name,raw in external.items():
            pin=facts['externalFiles'][name]
            p.require(type(raw) is bytes and len(raw)<=p.CAP and len(raw)==pin['bytes']
              and p.digest(raw)==pin['sha256'],'ROOT same job external full pin')
        bpin=facts['externalFiles'][p.EXTERNAL[0]]
        p.boundary(marker,ctx,facts,bpin)
        neutral=p.receipt_validate(receipt,ctx);out['processOutcome']=neutral
        stamps=[marker['start']]+[row[k] for row in journal['phases'] for k in ('entry','exit') if p.finite(row[k])]
        replay_now=max(stamps);inputs={k:facts['files'][k] for k in ('phase-journal.json','save-actual-command-receipt.json')}
        results=[]
        for role in p.EXTERNAL[1:]:
            computed=p.adjudicate(journal,receipt,marker,ctx,facts,bpin,replay_now,inputs,role)
            declared=p.strict_json(external[role]);p.require(p.equal(declared,computed),'external verdict conflict/recompute: '+role)
            p.require(computed['trusted'] is True and computed['eligible'] is True and computed['outcome']=='PASS','mandatory lifecycle AND fixed authority: '+role)
            results.append(computed)
        owner=p.strict_json(raws['save-owner-validation.json'])
        p.require(p.equal(owner,p.lifecycle(journal,receipt,ctx)) and owner['eligible'] is True,'independent owner validity mandatory')
        audit_validate(p,audits,facts['auditFiles'],ctx,terminal)
        p.require(p.equal(terminal['audit']['evidence']['rootIdentity'],facts['auditRootIdentity']),
          'authenticated audit root physical identity')
        before=p.strict_json(audits['before.json'])
        p.require(p.equal(before['physical'],facts['auditOwnerPhysical']) and
          p.equal(before['directories'],facts['auditOwnerDirectories']),'externally authenticated retained owner physical facts')
        for name in ('source-before.json','source-after.json'):
            p.require(p.strict_json(raws[name],65536).get('ok') is True,'strict source guard')
        source=p.strict_json(raws['source-context.json']);p.require(p.equal(source,{'identity':ctx['identity'],'sourcePins':ctx['sourcePins']}),'source context crossbinding')
        intent=p.strict_json(raws['phase-intent.json']);p.require(p.equal(intent,{'phases':list(p.PHASES),'commands':p.commands(ctx),'policy':p.POLICY}),'SAVE intent exact expected policy/argv')
        pre=p.strict_json(raws['source-preproducer.json'])
        p.require(p.equal(pre,{'ok':True,'identity':ctx['identity'],'sourcePins':ctx['sourcePins']}),'preproducer actual source binding')
        proof=p.strict_json(raws['projection-proof.json']);before_projection=p.strict_json(raws['projection-before-producer.json'])
        projected=proof['files'];required_projection={
          'simgolf-lite/'+p.SPEC,'simgolf-lite/'+p.RUNNER,
          'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.mjs',
          'simgolf-lite/scripts/zk1262-save-owner-diagnostic/save-owner-collector.d.mts'}
        p.require(set(projected)==required_projection and proof['created']==4 and proof['inverse'] is True,'exact projection source roles')
        for path,pin in projected.items():
            p.require({k:pin[k] for k in ('bytes','sha256')}==ctx['sourcePins'][path],'four current driver Git projection byte pins')
        p.require(p.equal(before_projection,{'files':projected,'ok':True}) and
          p.equal(terminal['projection']['files'],projected),'owned projection before producer and terminal crossbinding')
        setup=p.strict_json(raws['setup-status.json']);p.require(setup['failed'] is False and
          setup['firstCausePresent'] is False and setup['firstCause'] is None and setup['secondary']==[],'setup original failure cannot upgrade')
        status_receipt=p.strict_json(raws['producer-status.json']);exit_receipt=p.strict_json(raws['producer-exit.json'])
        for a,b in [('argv','outerRunnerArgv'),('cwd','cwdRole'),('entered','outerEntered'),('waited','outerWaited'),('completed','outerCompleted'),
          ('exitCode','outerExitCode'),('signal','outerSignal'),('timeoutPresent','timeoutPresent'),
          ('firstCausePresent','firstCausePresent'),('firstCause','firstCause'),
          ('startedMonotonic','startedMonotonic'),('endedMonotonic','endedMonotonic')]:
            p.require(p.equal(status_receipt[a],receipt[b]),'producer status actual outer receipt crossbinding')
        p.require(p.equal(exit_receipt,{key:status_receipt[key] for key in
          ('exitCode','signal','firstCausePresent','firstCause')}),'actual exit/signal crossbinding')
        p.require(all(ctx['sdkExpected'].get(k)==v for k,v in {'playwrightVersion':'1.61.1','revision':'1228',
          'platform':'linux','arch':'x64','browserName':'chromium'}.items()),'fixed default Linux SDK identity')
        sdk=p.strict_json(raws['sdk-binding.json']);p.require(p.equal(sdk['expected'],ctx['sdkExpected'])
          and p.equal(sdk['files'],facts['sdkFiles']),'externally qualified default SDK actual pins')
        inventory=p.strict_json(raws['inventory.json'],65536)
        expected={k:v for k,v in facts['files'].items() if k!='inventory.json'}
        p.require(p.equal(inventory['files'],expected) and p.equal(inventory['rootIdentity'],facts['rootIdentity'])
          and inventory['root']==ctx['artifactRoot'] and inventory['coexistingRawAndPart'] is False,'producer inventory exact historical pins')
        status=p.strict_json(raws['save-final-owner.preclose.json']);collector_validate(p,status,facts['files'],report,facts['rootIdentity'])
        out['trusted']=True
        out['diagnosticReady']=numerics['numericalPASS'] is True
        out['transportComplete']=True
        out['downstreamQualification']='Original later artifacts present; perturbed and no native closure proof'
        # capturePASS remains false until separately actual closure and graph intake.
    except BaseException as error:
        if not out['firstCausePresent']:out.update(firstCausePresent=True,firstCause={'type':type(error).__name__,'message':str(error)[:1024]})
        elif len(out['secondary'])<16:out['secondary'].append({'type':type(error).__name__,'message':str(error)[:1024]})
    return out


def directory_intake(p,ctx):
    # ROOT-provided producerFacts precede ACTUAL intake. Self-declared inventory
    # supplies no physical authority. Current stream pins only establish intake.
    facts=ctx['producerFacts'];root=Path(ctx['intakeRoot']);external_root=Path(ctx['intakeExternalRoot']);audit_root=Path(ctx['intakeAuditRoot'])
    current=p.inventory(root);p.require(set(current['files'])==set(facts['files']),'exact current roles')
    raws={}
    for name,pin in current['files'].items():
        p.require({k:pin[k] for k in ('bytes','sha256')}=={k:facts['files'][name][k] for k in ('bytes','sha256')},'current vs authenticated producer byte pin')
        if name in ('save-final-owner.heapsnapshot','save-final-owner.heapsnapshot.part'):raws[name]=facts['files'][name]
        else:raws[name]=p.file_bytes(root/name,p.ROLE_CAPS[name])[0]
    p.canonical(external_root);p.require({x.name for x in external_root.iterdir()}==set(p.EXTERNAL),'closed external roles')
    external={name:p.file_bytes(external_root/name,p.CAP)[0] for name in p.EXTERNAL}
    p.canonical(audit_root);p.require({x.name for x in audit_root.iterdir()}==set(facts['auditFiles']),'closed audit roles')
    audits={name:p.file_bytes(audit_root/name,65536)[0] for name in facts['auditFiles']}
    value=consume(p,ctx,raws,external,audits,facts);value['currentIntakePins']=current['files']
    return value


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


def main():
    a=argparse.ArgumentParser();a.add_argument('--phase',required=True);a.add_argument('--phase-sha256',required=True)
    a.add_argument('--context',required=True);a.add_argument('--context-sha256',required=True);a.add_argument('--output',required=True)
    args=a.parse_args();raw=source_bytes(args.phase,32768)
    if len(raw)>32768 or hashlib.sha256(raw).hexdigest()!=args.phase_sha256:raise RuntimeError('phase source binding')
    spec=importlib.util.spec_from_file_location('save_phase_adapter',args.phase);p=importlib.util.module_from_spec(spec);exec(compile(raw,str(args.phase),'exec'),p.__dict__)
    ctx=p.load_context(args.context,args.context_sha256);result=directory_intake(p,ctx);p.wx(args.output,result)
    print(json.dumps({'trusted':result['trusted'],'numericalPASS':result['numericalPASS'],'diagnosticReady':result['diagnosticReady'],'releaseCleared':False}))
    return 0 if result['trusted'] and result['diagnosticReady'] else 2
if __name__=='__main__':sys.exit(main())
