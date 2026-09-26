// Explicitly opt in. No message sync, send, draft, or config mutation.
import { loadDotEnvFiles } from '../src/secrets.js';
import { loadSources, loadSettings } from '../src/storage.js';
import { testEmailConnection } from '../src/adapters/email.js';
import { classifyWithAi } from '../src/ai.js';
const flags=new Set(process.argv.slice(2));
if(!flags.size || [...flags].some(flag=>!['--email','--ai'].includes(flag)))throw new Error('usage: node scripts/verify-live.mjs [--email] [--ai] (AI sends a synthetic fixture)');
loadDotEnvFiles();
const root=process.env.INTAKE_DIR || '.intake';
const result={};
if(flags.has('--email')){
 const source=(await loadSources(root)).find(source=>source.type==='email'&&source.enabled);
 if(!source)throw new Error('no enabled email source');
 const tested=await testEmailConnection(source);
 result.email={ok:tested.ok,imap:tested.checks.imap.ok,smtp:tested.checks.smtp.ok};
}
if(flags.has('--ai')){
 try{
  const value=await classifyWithAi({title:'Synthetic verification',body:'Please tell me your support hours.',tags:[],queue:'inbox',risk_level:'low'},await loadSettings(root));
  const fallback=value.assumptions?.includes('No provider call was made.')===true;
  result.ai={ok:Boolean(value.summary)&&!fallback,fallback};
 }catch(error){result.ai={ok:false,errorType:error.name};}
}
console.log(JSON.stringify(result,null,2));
if(Object.values(result).some(check=>!check.ok))process.exitCode=1;
