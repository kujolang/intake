import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCampaignCopy, checkCopy } from '../src/outreach-copy.js';
import { prospect, sign } from './helpers/outreach-copy.js';
const rewrite=(p,copy)=>{p.copy=copy;p.body=copy+'\n\nRobert';sign([p]);return p;};
test('reviewed individual copy passes the complete campaign gate',()=>assert.equal(checkCampaignCopy([prospect()]).passed,true));
for(const [name,change,reason] of [
 ['generic company intro',p=>rewrite(p,p.copy.replace('Your weekend family classes caught my attention while I was looking at the schedule on your website.',"I'm Robert with Ashford Software, and I wanted to introduce myself to your team.")),/introduction|boilerplate/],
 ['weak task pitch',p=>rewrite(p,p.copy.replace('Bringing the age guidance','I could help tidy up the age guidance')),/Weak task/],
 ['agency boilerplate',p=>rewrite(p,p.copy.replace('I build websites',"We're a full-service agency building websites")),/boilerplate/],
 ['unsupported assertion',p=>{p.claims[0].status='UNKNOWN';sign([p]);},/Unsupported/],
 ['undated evidence',p=>{delete p.claims[0].checked_on;sign([p]);},/dated/],
 ['accuracy below five',p=>{p.copy_review.scores.accuracy=4;},/accuracy/i],
 ['low business insight',p=>{p.copy_review.scores.insight=3;},/insight/],
 ['low total',p=>{for(const k of ['voice','closing','confidence'])p.copy_review.scores[k]=1;},/34\/40/],
 ['unreviewed edit',p=>{p.body+=' New claim';},/changed/],
 ['changed source evidence',p=>{p.sources[0].classification='UNKNOWN';},/evidence|changed/],
 ['unproven losses',p=>rewrite(p,p.copy.replace('A parent deciding', 'You are losing customers. A parent deciding')),/Unsupported outcome/],
]) test(`rejects ${name}`,()=>{const p=prospect();change(p);const result=checkCopy(p);assert.equal(result.passed,false);assert.match(result.failures.join(';'),reason);});
test('rejects identical openings, CTAs, introductions and interchangeable sentence patterns',()=>{
 const a=prospect(),b=prospect();b.canonical_id='SECOND';sign([a,b]);const r=checkCampaignCopy([a,b]);assert.equal(r.passed,false);
 for(const reason of ['Repetitive opening','Repeated closing','Repeated company','Interchangeable'])assert.match(r.results[0].failures.join(';'),new RegExp(reason));
});
test('requires explicit batch structure review and invalidates it after a batch change',()=>{
 const p=prospect();p.copy_review.structure_reviewed=false;assert.equal(checkCampaignCopy([p]).passed,false);
 p.copy_review.structure_reviewed=true;p.canonical_id='CHANGED';assert.equal(checkCampaignCopy([p]).passed,false);
});
