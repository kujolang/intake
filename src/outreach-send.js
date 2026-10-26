import { join } from 'node:path';
import { withStoreLock } from './store-lock.js';
import { withActionLock } from './action-lock.js';
import { loadSources, loadAction, loadItem, listActions, saveAction, saveItem, logEvent } from './storage.js';
import { readJson, writeJsonAtomic, sha256, stableStringify, assertSafeId } from './util.js';
import { requireCampaignCopy } from './outreach-copy.js';
import { checkOutreachLimits } from './outreach-limits.js';
import { inspectEmailHistory, verifyEmailDraft, deliverApprovedOutreach, outreachDeliveryFingerprint } from './adapters/email.js';

// An explicit operator authorization overrides draft-only policy for these exact
// snapshots only. Neither dashboard approval nor draft creation invokes this API.
export async function sendApprovedOutreach(root, manifest, dependencies = {}) {
  if (manifest?.intent !== 'SEND_EXACT_REVIEWED_DRAFTS' || !manifest.approved_by || !manifest.authorization || !manifest.approved_at || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 10) throw new Error('explicit bounded send authorization required');
  assertSafeId(manifest.campaign_id);
  if (new Set(manifest.entries.map(e => e.action_id)).size !== manifest.entries.length) throw new Error('duplicate authorization entries');
  return withStoreLock(root, () => withActionLock(root, async () => {
    const base = join(root, 'campaigns', manifest.campaign_id);
    const journalPath = join(base, `delivery-${sha256(stableStringify(manifest))}.json`);
    const previous = await readJson(journalPath, null);
    if (previous?.status === 'complete') return previous;
    if (previous) throw new Error('delivery already started; reconcile without resending');
    const source = (await loadSources(root)).find(s => s.id === manifest.source_id);
    if (!source?.enabled || source.type !== 'email') throw new Error('enabled email source required');
    const suppressions = await readJson(join(root, 'outreach-suppressions.json'), []);
    if (!Array.isArray(suppressions) || suppressions.some(s => typeof s?.identity !== 'string')) throw new Error('invalid suppressions');
    const actions = await listActions(root);
    checkOutreachLimits(await readJson(join(root, 'outreach-limits.json'), null), actions, source.id, manifest.entries.length);
    const plans = [];
    for (const entry of manifest.entries) {
      assertSafeId(entry.action_id);
      const action = await loadAction(root, entry.action_id), item = action && await loadItem(root, action.intake_item_id);
      if (!item || action.source_id !== source.id || item.source_id !== source.id || action.type !== 'draft_response' || action.status !== 'executed' || action.metadata?.outreach?.campaign_id !== manifest.campaign_id) throw new Error('approved draft identity mismatch');
      const o = action.metadata.outreach;
      if (o.holds?.length || item.metadata?.outreach?.holds?.length || item.metadata?.outreach?.delivery || action.metadata?.delivery) throw new Error('held or previously submitted draft');
      if (entry.fingerprint !== outreachDeliveryFingerprint(source, action, item)) throw new Error('approved content changed');
      const batch = o.batch_id;
      if (batch) assertSafeId(batch);
      const dir = batch ? join(base, 'batches', batch) : base;
      const campaign = await readJson(join(dir, 'campaign.json'));
      requireCampaignCopy([...(campaign.review_context || []), ...campaign.prospects]);
      const p = campaign.prospects.find(p => p.canonical_id === o.canonical_id);
      const state = await readJson(join(dir, 'state.json')), record = state.prospects[o.canonical_id];
      if (!p?.eligible || p.contact_status !== 'VERIFIED' || !p.email || p.email !== item.author_email || action.metadata.to && action.metadata.to !== p.email || p.subject !== action.metadata.subject || p.body !== action.body || record?.status !== 'DRAFTED' || record.action_id !== action.id || record.holds?.length) throw new Error('draft eligibility or reviewed copy mismatch');
      const terms = [p.canonical_id, p.email, ...(p.identity_terms || [])].map(t => t.toLowerCase());
      if (suppressions.some(s => terms.includes(s.identity.toLowerCase()))) throw new Error('recipient suppressed');
      if (actions.some(a => a.type === 'send_response' && (a.intake_item_id === item.id || a.metadata?.to?.toLowerCase() === p.email.toLowerCase()) && a.status !== 'rejected')) throw new Error('existing send action; reconcile before sending');
      const history = await (dependencies.history || inspectEmailHistory)(source, [p.email, ...p.identity_terms]);
      if (!history.complete || !Array.isArray(history.matches) || history.matches.some(m => !(m.mailbox === record.receipt.appended_to && String(m.uid) === String(record.receipt.uid)) && !(record.revision_receipts || []).some(r => r.archived_uid && m.mailbox === r.archived_to && String(m.uid) === String(r.archived_uid)))) throw new Error('new correspondence or duplicate draft requires review');
      const verification = await (dependencies.verify || verifyEmailDraft)(source, action, item);
      if (!verification.ok || String(verification.uid) !== String(record.receipt.uid)) throw new Error('remote draft changed');
      plans.push({ entry, action, item, dir, canonical_id: p.canonical_id, history, verification });
    }
    // Preflight the complete batch before the first external send.
    const journal = { status: 'started', authorization: manifest, started_at: new Date().toISOString(), deliveries: {} };
    await writeJsonAtomic(journalPath, journal);
    for (const plan of plans) {
      const { action, item, entry, canonical_id } = plan;
      const id = `act_delivery_${sha256(action.id)}`;
      const send = { ...action, id, type: 'send_response', status: 'executing', approved_by: manifest.approved_by, approved_at: manifest.approved_at, executed_at: null, result: null, metadata: { ...action.metadata, to: item.author_email, approved_delivery: entry.fingerprint, draft_action_id: action.id } };
      journal.deliveries[canonical_id] = { status: 'executing', action_id: id, draft_action_id: action.id, history: plan.history, verification: plan.verification };
      await writeJsonAtomic(journalPath, journal);
      await saveAction(root, send);
      const recordReceipt = async receipt => {
        journal.deliveries[canonical_id] = { ...journal.deliveries[canonical_id], ...receipt };
        await writeJsonAtomic(journalPath, journal);
      };
      let result;
      try {
        result = await (dependencies.deliver || deliverApprovedOutreach)(source, action, item, entry.fingerprint, recordReceipt);
        await recordReceipt({ status: 'sent', result });
      } catch (error) {
        await saveAction(root, { ...send, status: 'execution_uncertain', result: { ...journal.deliveries[canonical_id], error: 'Reconcile receipt and mailbox; do not resend.' } });
        throw error;
      }
      await saveAction(root, { ...send, status: 'executed', executed_at: new Date().toISOString(), result });
      await saveAction(root, { ...action, metadata: { ...action.metadata, delivery: { action_id: id, ...result } } });
      await saveItem(root, { ...item, status: 'resolved', queue: 'resolved', updated_at: new Date().toISOString(), metadata: { ...item.metadata, outreach: { ...item.metadata.outreach, delivery: { action_id: id, ...result } } } });
      const state = await readJson(join(plan.dir, 'state.json'));
      Object.assign(state.prospects[canonical_id], { status: 'SENT', approval_status: 'APPROVED_FOR_THIS_SEND', delivery: { action_id: id, ...result } });
      state.events.push({ at: new Date().toISOString(), event: 'smtp_accepted_and_sent_copy_verified', prospect_id: canonical_id, action_id: id });
      await writeJsonAtomic(join(plan.dir, 'state.json'), state);
      await logEvent(root, 'actions', { event_type: 'outreach_explicit_send', action_id: id, item_id: item.id, source_id: source.id, status: 'executed', message_id: result.message_id });
    }
    journal.status = 'complete'; journal.completed_at = new Date().toISOString();
    await writeJsonAtomic(journalPath, journal);
    return journal;
  }));
}
