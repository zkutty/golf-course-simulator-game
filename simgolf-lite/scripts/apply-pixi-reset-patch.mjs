import {readFileSync,writeFileSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const metadata=JSON.parse(readFileSync(new URL('./pixi-reset-patch.json',import.meta.url),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function applyPatch(appRoot){
 const root=realpathSync(appRoot),pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')),lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8'));
 const installedRoot=realpathSync(resolve(root,'node_modules/pixi.js'));if(!installedRoot.startsWith(root+sep))throw Error('Pixi patch refuses external shared dependency tree');
 const installed=JSON.parse(readFileSync(resolve(installedRoot,'package.json'),'utf8')),locked=lock.packages?.['node_modules/pixi.js'];
 if(pkg.dependencies?.['pixi.js']!==metadata.version||lock.packages?.['']?.dependencies?.['pixi.js']!==metadata.version||installed.version!==metadata.version||locked?.version!==metadata.version||locked.integrity!==metadata.integrity||locked.resolved!==metadata.resolved)throw Error('Pixi exact package/lock/version guard failed');
 const plans=metadata.files.map(f=>{const path=resolve(installedRoot,f.relativePath);if(!realpathSync(path).startsWith(installedRoot+sep))throw Error('Pixi patch external target');const raw=readFileSync(path),digest=hash(raw);if(digest===f.patchedSha256)return {path,changed:false};if(digest!==f.originalSha256)throw Error('Pixi unknown source hash '+f.relativePath);let text=raw.toString('utf8');for(const edit of f.edits){if(text.split(edit.before).length!==2)throw Error('Pixi exact patch site guard');text=text.replace(edit.before,edit.after);}const out=Buffer.from(text);if(hash(out)!==f.patchedSha256)throw Error('Pixi patch output hash guard');return {path,changed:true,out};});
 // Preflight ALL files before any write. Atomic per-file rename; mixed admitted states
 // permit recovery after filesystem interruption, but successful exit verifies ALL.
 for(const plan of plans){if(!plan.changed)continue;const temp=plan.path+'.reset-patch-'+process.pid+'.tmp';try{writeFileSync(temp,plan.out,{flag:'wx'});renameSync(temp,plan.path);}finally{try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}}
 for(let i=0;i<plans.length;i++)if(hash(readFileSync(plans[i].path))!==metadata.files[i].patchedSha256)throw Error('Pixi final patch verification failed');
 return {version:metadata.version,changed:plans.filter(p=>p.changed).length,verified:plans.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=applyPatch(resolve(dirname(fileURLToPath(import.meta.url)),'..'));console.log('Pixi reset patch verified '+JSON.stringify(result));}
