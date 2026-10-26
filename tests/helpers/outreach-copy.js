import { COPY_DIMENSIONS, WRITING_POLICY, copyHash } from '../../src/outreach-copy.js';
import { sha256, stableStringify } from '../../src/util.js';
export function sign(prospects) {
  for(const p of prospects) {
    p.copy_review ||= {policy:WRITING_POLICY,orwell_applied:true,reviewer:'Test fixture editorial review',reviewed_at:'2026-10-26',material_claims_complete:true,unsupported_claims:false,structure_reviewed:true,distinctiveness_notes:'A specific family orientation opportunity.',scores:Object.fromEntries(COPY_DIMENSIONS.map(k=>[k,5])),rationale:Object.fromEntries(COPY_DIMENSIONS.map(k=>[k,'Synthetic reviewed fixture.']))};
    p.copy_review.content_hash=copyHash(p);
  }
  const hash=sha256(stableStringify(prospects.map(p=>({id:p.canonical_id,hash:copyHash(p)}))));
  for(const p of prospects)p.copy_review.batch_hash=hash;
  return prospects;
}
export function prospect() {
 const copy=`Hey Specific Gym team,

Your weekend family classes caught my attention while I was looking at the schedule on your website.

A parent deciding whether to try a class may want to know how the sessions work before choosing one. Bringing the age guidance and first-visit details together could make that decision easier.

I build websites and business systems through Ashford Software. This looks like an opportunity to help families get comfortable with the first step while keeping your existing registration process.

Are you considering changes to how families prepare for their first class?`;
 return sign([{canonical_id:'ASH-TEST',name:'Specific Gym',email:'owner@example.com',original_ids:['ASH-TEST'],identity_terms:['Specific Gym'],subject:'Family class preparation',copy,body:copy+'\n\nRobert',eligible:true,contact_status:'VERIFIED',sources:[{url:'https://example.test/classes',classification:'VERIFIED'}],claims:[{text:'Your weekend family classes',url:'https://example.test/classes',status:'VERIFIED',reviewed:true,checked_on:'2026-10-26'}],angle:'Family class orientation',observation:'Published weekend family classes',implication:'Parents may want first-visit guidance',opportunity:'Clearer preparation could support family decisions',qa:{passed:true,score:40,scale:40}}])[0];
}
