import { readdir } from 'node:fs/promises';
import { copyHash, requireCampaignCopy } from './outreach-copy.js';
// Automated campaign creation stays draft-only; explicit operator delivery is separate.
import { join } from 'node:path';
import { withStoreLock } from './store-lock.js';
import { loadSources, listItems, listActions, loadAction, saveItem, saveAction, logEvent } from './storage.js';
import { makeItem, makeAction } from './models.js';
import { readJson, writeJsonAtomic, sha256, stableStringify, assertSafeId } from './util.js';
import { inspectEmailHistory } from './adapters/email.js';
import { approveAction, runAction } from './workflow.js';

export function parseResearchCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error('unterminated CSV field');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  if (!headers?.includes('prospect_id')) throw new Error('research CSV requires prospect_id');
  const ids = new Set();
  return rows.filter(r => r.some(Boolean)).map(r => {
    if (r.length !== headers.length) throw new Error('CSV column count mismatch');
    const record = Object.fromEntries(headers.map((h, i) => [h, r[i]]));
    if (!record.prospect_id || ids.has(record.prospect_id)) throw new Error('missing or repeated source ID');
    ids.add(record.prospect_id); return record;
  });
}

export function normalizeCollection(records, collection, merges = []) {
  const selected = records.filter(r => r.research_collection.split('|').map(x => x.trim().toLowerCase()).includes(collection.toLowerCase()));
  const byId = new Map(selected.map(r => [r.prospect_id, r]));
  const assigned = new Set(); const groups = [];
  for (const merge of merges) {
    if (!merge.reason || merge.ids.length < 2) throw new Error('identity merge requires evidence');
    for (const id of merge.ids) {
      if (!byId.has(id) || assigned.has(id)) throw new Error('invalid or overlapping identity merge');
      assigned.add(id);
    }
    groups.push({ canonical_id: merge.ids[0], original_ids: merge.ids, identity_reason: merge.reason, records: merge.ids.map(id => byId.get(id)) });
  }
  for (const r of selected) if (!assigned.has(r.prospect_id)) groups.push({ canonical_id: r.prospect_id, original_ids: [r.prospect_id], identity_reason: 'Unmerged research candidate; shared names alone do not establish identity.', records: [r] });
  return groups;
}

export function validateCampaign(c) {
  assertSafeId(c.id, 'campaign ID');
  if(c.batch_id !== undefined) assertSafeId(c.batch_id, 'batch ID');
  if (c.mode !== 'DRAFT' || c.sending_authorized !== false) throw new Error('only DRAFT campaigns with sending_authorized=false are supported');
  if (!c.source_id || !c.sender_email || !Array.isArray(c.prospects) || c.prospects.length > 5) throw new Error('campaign source, sender, and at most five prospects required');
  if (new Set(c.prospects.map(p => p.canonical_id)).size !== c.prospects.length) throw new Error('duplicate campaign identity');
  for (const p of c.prospects) {
    assertSafeId(p.canonical_id, 'prospect ID');
    if (!Array.isArray(p.identity_terms) || !p.identity_terms.length || p.identity_terms.some(x => typeof x !== 'string' || x.trim().length < 4)) throw new Error('specific identity terms required');
    if (p.email && !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(p.email)) throw new Error('invalid single recipient');
    if (typeof p.subject !== 'string' || /[\r\n]/.test(p.subject) || !p.subject.trim()) throw new Error('invalid subject');
    if (!p.body || !p.original_ids?.length) throw new Error('body and source IDs required');
    if (p.eligible && (!p.email || p.contact_status !== 'VERIFIED' || !p.sources?.length || p.qa?.passed !== true)) throw new Error('eligible draft requires verified contact, evidence and QA');
  }
}

export async function draftCampaign(root, campaign, dependencies = {}) {
  validateCampaign(campaign);
  requireCampaignCopy([...(campaign.review_context || []), ...campaign.prospects]);
  return withStoreLock(root, async () => {
    const base=await campaignBase(root,campaign);
    const sources = await loadSources(root);
    const source = sources.find(s => s.id === campaign.source_id);
    if (!source?.enabled || source.type !== 'email' || source.config?.username?.toLowerCase() !== campaign.sender_email.toLowerCase()) throw new Error('campaign sender does not match enabled Intake mailbox');
    const suppressions = await readJson(join(root, 'outreach-suppressions.json'), []);
    if (!Array.isArray(suppressions) || suppressions.some(s => !s || typeof s.identity !== 'string')) throw new Error('invalid account suppression records');
    const path = join(base, 'state.json');
    const state = await readJson(path, { id: campaign.id, batch_id: campaign.batch_id || null, mode: 'DRAFT', sending_authorized: false, prospects: {}, events: [] });
    const fingerprint = sha256(stableStringify(campaign));
    if (state.config_hash && state.config_hash !== fingerprint) throw new Error('campaign changed; review existing drafts before replacing configuration');
    state.config_hash = fingerprint;
    await writeJsonAtomic(join(base, 'campaign.json'), campaign);
    const history = dependencies.history || inspectEmailHistory;
    const execute = dependencies.execute || (async id => {
      await approveAction(root, id, 'user-authorized-draft-persistence-only');
      return runAction(root, id);
    });
    for (const p of campaign.prospects) {
      const key = sha256(`${campaign.sender_email.toLowerCase()}:${p.canonical_id}`);
      const actionId = `act_outreach_${key}`;
      const itemId = `itm_outreach_${key}`;
      const existing = await loadAction(root, actionId);
      if (existing) {
        if (existing.metadata?.campaign_review || existing.metadata?.campaign_delivery || existing.metadata?.delivery) {
          if (!state.prospects[p.canonical_id]) throw new Error("Operator campaign state requires reconciliation");
          continue; // Preserve manual edits, delivery receipts and sent status.
        }
        if (existing.metadata?.outreach?.content_hash !== sha256(stableStringify(p))) throw new Error('existing business draft differs; manual review required');
        state.prospects[p.canonical_id] = { ...(state.prospects[p.canonical_id] || {}), action_id: actionId, item_id: itemId, status: existing.status === 'executed' ? 'DRAFTED' : (state.prospects[p.canonical_id]?.status || 'NEEDS_VERIFICATION'), receipt: existing.result, note: 'Existing draft/proposal preserved; no retry or duplicate append.' };
        continue;
      }
      const terms = [...new Set([...p.identity_terms, ...(p.email ? [p.email] : [])])].map(x => x.toLowerCase());
      const matched = value => terms.some(t => value.toLowerCase().includes(t));
      const items = await listItems(root); const actions = await listActions(root);
      const local = items.filter(i => matched(JSON.stringify(i)) && !i.metadata?.demo_seed_id);
      const localActions = actions.filter(a => matched(JSON.stringify(a)) || local.some(i => i.id === a.intake_item_id));
      const suppressed = suppressions.some(s => terms.includes(s.identity.toLowerCase()) || s.identity === p.canonical_id);
      let checked;
      try { checked = await history(source, terms); }
      catch { checked = { complete: false, matches: [], error: 'Mailbox history check failed; held without external action.' }; }
      const holds = [...(p.holds || [])];
      if (suppressed) holds.push('Account-wide suppression');
      if (local.length || localActions.length || checked.matches?.length) holds.push('Existing correspondence/action; relationship review required');
      if (checked.complete !== true || !Array.isArray(checked.matches)) holds.push('Incomplete mailbox history');
      if (!p.eligible) holds.push('Prospect not eligible for remote draft');
      if (!p.email || p.contact_status !== 'VERIFIED') holds.push('NEEDS_CONTACT_ROUTE');
      const status = holds.length ? (suppressed ? 'DO_NOT_CONTACT' : !p.email ? 'NEEDS_CONTACT_ROUTE' : 'NEEDS_VERIFICATION') : 'AWAITING_APPROVAL';
      const metadata = { outreach: { campaign_id: campaign.id, batch_id: campaign.batch_id || null, canonical_id: p.canonical_id, original_ids: p.original_ids, mode: 'DRAFT', send_blocked: true, content_hash: sha256(stableStringify(p)), holds, sources: p.sources, qa: p.qa, copy_review: p.copy_review }, subject: p.subject, draft_message_id: `<ashford-${key}@${campaign.sender_email.split('@')[1]}>` };
      await saveItem(root, makeItem({ id: itemId, source_id: source.id, source_type: 'email', title: p.subject, body: p.body, author: p.name, author_email: p.email || null, queue: 'sales', category: `outreach:${campaign.id}`, status: 'needs_review', tags: ['outreach', campaign.id], metadata }));
      await saveAction(root, makeAction({ id: actionId, intake_item_id: itemId, source_id: source.id, type: 'draft_response', status: 'needs_review', body: p.body, metadata }));
      state.prospects[p.canonical_id] = { status, item_id: itemId, action_id: actionId, holds, history: { ...checked, local_item_count: local.length, local_action_count: localActions.length }, receipt: null };
      state.events.push({ at: new Date().toISOString(), prospect_id: p.canonical_id, event: 'review_proposal_saved', action_id: actionId });
      await writeJsonAtomic(path, state);
      if (!holds.length) {
        try {
          const result = await execute(actionId);
          state.prospects[p.canonical_id].status = result.status === 'executed' ? 'DRAFTED' : 'ERROR';
          state.prospects[p.canonical_id].receipt = result.result;
        } catch {
          state.prospects[p.canonical_id].status = 'ERROR';
          state.prospects[p.canonical_id].holds.push('Draft append outcome uncertain; reconcile mailbox before any retry.');
        }
        state.events.push({ at: new Date().toISOString(), prospect_id: p.canonical_id, event: state.prospects[p.canonical_id].status, action_id: actionId });
        await writeJsonAtomic(path, state);
      }
      await logEvent(root, 'audit', { event_type: 'outreach_draft_review', action_id: actionId, item_id: itemId, status: state.prospects[p.canonical_id].status });
    }
    await writeJsonAtomic(path, state);
    return state;
  });
}

export async function campaignBase(root, campaign) {
  const parent = join(root, 'campaigns', campaign.id);
  const base = campaign.batch_id ? join(parent, 'batches', campaign.batch_id) : parent;
  const prior = [];
  if (campaign.batch_id) {
    const first = await readJson(join(parent, 'campaign.json'), null);
    if (!first || first.source_id !== campaign.source_id || first.sender_email !== campaign.sender_email) throw new Error('batch requires the existing campaign sender');
    prior.push(...first.prospects);
  }
  const batches = await readdir(join(parent, 'batches')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of batches) {
    if (name === campaign.batch_id) continue;
    const saved = await readJson(join(parent, 'batches', name, 'campaign.json'), null);
    if (saved) prior.push(...saved.prospects);
  }
  const context = campaign.review_context || [];
  if (context.length !== prior.length || prior.some(p => !context.some(q => q.canonical_id === p.canonical_id && copyHash(q) === copyHash(p)))) throw new Error('batch must compare all previously saved campaign copy unchanged');
  if (campaign.prospects.some(p => prior.some(q => q.canonical_id === p.canonical_id))) throw new Error('batch must contain new campaign prospects');
  return base;
}
