import { sha256, stableStringify } from './util.js';

export const WRITING_POLICY = 'ashford-outreach/1.0.0';
export const COPY_DIMENSIONS = ['specificity', 'accuracy', 'insight', 'value', 'voice', 'confidence', 'closing', 'distinctiveness'];
const normalize = value => String(value || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const words = value => normalize(value).split(' ').filter(Boolean);
const paragraphs = p => p.copy.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).filter(x=>! /^(hey|hi|hello)\b[^.!?]*,$/i.test(x));
export const copyHash = p => sha256(stableStringify({ subject: p.subject, copy: p.copy, body: p.body, angle: p.angle, claims: p.claims, sources: p.sources, observation: p.observation, implication: p.implication, opportunity: p.opportunity }));

export function checkCopy(p) {
  const failures = [];
  if (!p.copy || !p.body?.startsWith(p.copy)) return { passed:false, total:0, failures:['Missing reviewed copy or body differs from copy'] };
  const count = p.copy.trim().split(/\s+/).length;
  if (count < 75 || count > 130) failures.push('Copy must be 75–130 words, excluding signature/footer');
  if ((p.copy.match(/\?/g)||[]).length !== 1) failures.push('Use one closing question');
  if (!p.copy.trim().endsWith('?')) failures.push('Close with the opportunity-specific question');
  if (/\bASH-[A-Z]+-\d+\b/i.test(p.subject || '')) failures.push('Keep campaign identifiers out of email subjects');
  if (!p.subject || p.subject.length > 85 || /[\r\n!]/.test(p.subject)) failures.push('Use a short, natural subject');
  if (/\p{Extended_Pictographic}/u.test(p.copy)) failures.push('No emojis');
  const text = p.copy.replace(/[’‘]/g, "'");
  const weak = /\b(i could help tidy up|i can fix that for you|would you like help with your website|i could build a (little|short) page|would that be useful|is that something you'd like help with|i'd be happy to|just reaching out|i wanted to introduce myself|full.service agency|small cleanup|just a quick fix|unlock your|revolutionize|transform your digital presence|leverage cutting.edge)\b/i;
  if (weak.test(text)) failures.push('Weak task pitch or agency boilerplate');
  if (/\b(guarantee|guaranteed|losing (customers|members|revenue)|costing you|boost .* by \d|increase .* by \d)\b/i.test(text)) failures.push('Unsupported outcome/guarantee language needs removal');
  const opening = paragraphs(p)[0] || '';
  if (/^(i('m| am)|we('re| are)|i run|my name is)\b/i.test(opening)) failures.push('Lead with recipient evidence, not a company introduction');
  for (const field of ['angle','observation','implication','opportunity']) if (typeof p[field] !== 'string' || words(p[field]).length < 3) failures.push(`Missing substantive ${field}`);
  if (!Array.isArray(p.claims) || !p.claims.length) failures.push('Missing material-claim evidence ledger');
  for (const claim of p.claims || []) {
    if (!claim.text || !p.copy.includes(claim.text) || claim.reviewed !== true) failures.push('Claim must match reviewed copy');
    if (claim.status === 'VERIFIED') {
      if (!claim.url || !p.sources?.some(s=>s.url===claim.url && s.classification==='VERIFIED') || !/^\d{4}-\d{2}-\d{2}$/.test(claim.checked_on || '')) failures.push('Verified claim lacks dated source evidence');
    } else if (claim.status === 'INFERRED') {
      if (!/\b(could|may|might|would|opportunity|imagine|potential|can be|looks like)\b/i.test(claim.text)) failures.push('Unproven impact must be conditional');
    } else failures.push('Unsupported or unknown material claim');
  }
  const review = p.copy_review || {};
  let total = 0;
  for (const dimension of COPY_DIMENSIONS) {
    const value=review.scores?.[dimension];
    if (!Number.isInteger(value) || value < 0 || value > 5) failures.push(`Missing valid ${dimension} score`); else total+=value;
    if (!review.rationale?.[dimension]?.trim()) failures.push(`Missing ${dimension} rationale`);
  }
  if (total < 34) failures.push('Copy score below 34/40');
  if (review.scores?.accuracy !== 5) failures.push('Research accuracy must be 5/5');
  if (review.scores?.insight < 4 || review.scores?.value < 4) failures.push('Business insight and value must each reach 4/5');
  if (review.policy !== WRITING_POLICY || review.orwell_applied !== true) failures.push('Current Ashford policy and Orwell review required');
  if (!review.reviewer || !review.reviewed_at || review.material_claims_complete !== true || review.unsupported_claims !== false) failures.push('Explicit complete factual review required');
  if (review.content_hash !== copyHash(p)) failures.push('Copy changed since review');
  return { passed:failures.length===0, total, word_count:count, failures };
}

export function checkCampaignCopy(prospects) {
  const results = prospects.map(p=>({id:p.canonical_id,...checkCopy(p)}));
  const add = (i,message) => { results[i].passed=false;results[i].failures.push(message); };
  for(let i=0;i<prospects.length;i++) for(let j=0;j<i;j++) {
    if(!prospects[i].copy || !prospects[j].copy) continue;
    const a=paragraphs(prospects[i]),b=paragraphs(prospects[j]);
    if(words(a[0]).slice(0,6).join(' ')===words(b[0]).slice(0,6).join(' ')) { add(i,'Repetitive opening');add(j,'Repetitive opening'); }
    if(normalize(a.at(-1))===normalize(b.at(-1))) { add(i,'Repeated closing question');add(j,'Repeated closing question'); }
    const introsA=a.filter(x=>/ashford software/i.test(x)),introsB=b.filter(x=>/ashford software/i.test(x));
    if(introsA.some(x=>introsB.some(y=>normalize(x)===normalize(y)))) { add(i,'Repeated company introduction');add(j,'Repeated company introduction'); }
    const grams = p => {const w=words(p.copy);return new Set(w.slice(0,-4).map((_,k)=>w.slice(k,k+5).join(' ')));};
    const ga=grams(prospects[i]),gb=grams(prospects[j]);
    const overlap=[...ga].filter(x=>gb.has(x)).length/Math.max(1,Math.min(ga.size,gb.size));
    if(overlap>0.32) { add(i,'Interchangeable sentence pattern/content');add(j,'Interchangeable sentence pattern/content'); }
  }
  // Similar word counts alone are not evidence of templating. Review sentence
  // structure explicitly, with a record bound to the exact campaign text.
  const batchHash=sha256(stableStringify(prospects.map(p=>({id:p.canonical_id,hash:copyHash(p)}))));
  for(let i=0;i<prospects.length;i++) {
    const r=prospects[i].copy_review;
    if(r?.batch_hash!==batchHash || r?.structure_reviewed!==true || !r?.distinctiveness_notes) add(i,'Campaign-wide structure/distinctiveness review required');
  }
  return { passed:results.every(r=>r.passed), results, batch_hash:batchHash };
}

export function requireCampaignCopy(prospects) {
  const result=checkCampaignCopy(prospects);
  if(!result.passed) throw new Error(`Outreach copy gate failed: ${result.results.filter(r=>!r.passed).map(r=>`${r.id}: ${r.failures.join('; ')}`).join(' | ')}`);
  return result;
}
