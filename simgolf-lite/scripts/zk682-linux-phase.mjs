import { writeSync } from "node:fs";
let records=0,bytes=0,overflow=false,secondaryLoggingFailures=0;
export function phaseStatus(){return {records,bytes,overflow,secondaryLoggingFailures};}
export function markPhase(name,stage,error,details={}){
  try {
    if(overflow)return;
    const line=JSON.stringify({name,stage,hostMs:performance.now(),...details,...(stage==="error"?{error:String(error).slice(0,512)}:{}),secondaryLoggingFailures})+"\n";
    const size=Buffer.byteLength(line);
    if(records>=511||bytes+size>65280){overflow=true;const terminal=JSON.stringify({name:"phase-bound",stage:"overflow",hostMs:performance.now(),records,bytes,invalidDiagnostic:true})+"\n";writeSync(1,terminal);records++;bytes+=Buffer.byteLength(terminal);return;}
    writeSync(1,line);records++;bytes+=size;
  }catch{secondaryLoggingFailures++;}
}
export async function phase(name,action){markPhase(name,"enter");try{const value=await action();markPhase(name,"exit");return value;}catch(error){markPhase(name,"error",error);throw error;}}

export async function withDiagnosticStatus(name, action) {
  let failed = false, primary, value;
  try { value = await action(); } catch (error) { failed = true; primary = error; }
  markPhase(name, "status", undefined, { diagnosticStatus: phaseStatus(), invalidDiagnostic: phaseStatus().overflow || phaseStatus().secondaryLoggingFailures > 0 });
  const status = phaseStatus();
  if (!failed && (status.overflow || status.secondaryLoggingFailures)) { failed = true; primary = new Error("Diagnostic phase logger failed or overflowed; diagnostic invalid"); }
  if (failed) throw primary;
  return value;
}
