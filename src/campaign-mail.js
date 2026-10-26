import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withStoreLock } from './store-lock.js';
import { withActionLock } from './action-lock.js';
import { loadAction, loadItem, loadSources, listActions, loadPolicies, loadSettings, saveAction, saveItem, logEvent } from './storage.js';
import { assertSafeId, readJson, writeJsonAtomic, sha256, stableStringify } from './util.js';
import { campaignMessageHash } from './campaign-message.js';
import { sendEmailResponse } from './adapters/email.js';
import { evaluatePolicy } from './policy.js';
import { checkOutreachLimits } from './outreach-limits.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { statusCode: status }); };
const version = action => sha256(stableStringify(action));
const validEmail = value => /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value || '');

async function context(root, action, item) {
  const outreach = action.metadata?.outreach;
  if (!outreach || !item || item.metadata?.outreach?.canonical_id !== outreach.canonical_id || item.source_id !== action.source_id) fail(400, 'Campaign identity mismatch');
  assertSafeId(outreach.campaign_id, 'campaign ID');
  assertSafeId(outreach.canonical_id, 'prospect ID');
  if (outreach.batch_id) assertSafeId(outreach.batch_id, 'batch ID');
  const base = outreach.batch_id ? join(root, 'campaigns', outreach.campaign_id, 'batches', outreach.batch_id) : join(root, 'campaigns', outreach.campaign_id);
  const campaign = await readJson(join(base, 'campaign.json'), null);
  const state = await readJson(join(base, 'state.json'), null);
  const prospect = campaign?.prospects?.find(p => p.canonical_id === outreach.canonical_id);
  const record = state?.prospects?.[outreach.canonical_id];
  if (!prospect || !record || record.action_id !== action.id || record.item_id !== item.id || campaign.source_id !== action.source_id || campaign.id !== outreach.campaign_id) fail(400, 'Campaign records require reconciliation');
  for (const name of await readdir(base)) {
    if (name.startsWith('revision-') && name.endsWith('.json') && (await readJson(join(base, name)))?.status !== 'complete') fail(409, 'A campaign revision is unfinished; reconcile it before editing or sending');
  }
  const source = (await loadSources(root)).find(s => s.id === action.source_id);
  return { base, campaign, state, prospect, record, source };
}

async function checkDeliveryEligibility(root, action, item, c) {
  const { source, campaign, prospect, record } = c;
  if (!source?.enabled || source.type !== 'email') fail(400, 'An enabled email account is required');
  const sender = source.config?.from || source.config?.username || '';
  const senderAddress = sender.match(/<([^<>]+)>$/)?.[1] || sender;
  if (source.config?.username?.toLowerCase() !== campaign.sender_email?.toLowerCase() || senderAddress.toLowerCase() !== campaign.sender_email?.toLowerCase()) fail(400, 'Campaign sender changed; restore the verified sending account');
  if (!validEmail(item.author_email) || item.author_email !== prospect.email || prospect.contact_status !== 'VERIFIED' || !prospect.eligible) fail(400, 'A verified, eligible campaign recipient is required');
  if (action.metadata?.to && action.metadata.to !== item.author_email) fail(400, 'Recipient changed; separate contact verification is required');
  const holds = [...(prospect.holds || []), ...(record.holds || []), ...(action.metadata.outreach.holds || []), ...(item.metadata?.outreach?.holds || [])];
  if (holds.length || item.status === 'blocked' || ['ERROR', 'DO_NOT_CONTACT', 'NEEDS_CONTACT_ROUTE', 'NEEDS_VERIFICATION'].includes(record.status)) fail(400, 'Resolve campaign contact or relationship holds before approving or sending');
  const suppressions = await readJson(join(root, 'outreach-suppressions.json'), []);
  if (!Array.isArray(suppressions) || suppressions.some(s => typeof s?.identity !== 'string')) fail(400, 'Invalid suppression records');
  const identities = [prospect.canonical_id, prospect.email, ...(prospect.identity_terms || [])].filter(Boolean).map(s => s.toLowerCase());
  if (suppressions.some(s => identities.includes(s.identity.toLowerCase()))) fail(400, 'This recipient is suppressed');
  if (!action.body?.trim() || !action.metadata?.subject?.trim() || /[\r\n]/.test(action.metadata.subject)) fail(400, 'A message and single-line subject are required');
}

// Independent manual workflow. It never enables unattended campaign sending or
// changes the existing draft-only automation policies.
export async function editCampaignMail(root, command, id, body) {
  return withStoreLock(root, () => withActionLock(root, async () => {
    let action = await loadAction(root, id);
    if (!action) fail(404, 'No such campaign draft');
    if (body.version !== version(action)) fail(409, 'This draft changed. Reopen it before saving, approving or sending.');
    const item = await loadItem(root, action.intake_item_id);
    const c = await context(root, action, item);
    const priorSends = await listActions(root, { intake_item_id: item.id });
    if (action.metadata?.delivery || item.metadata?.outreach?.delivery || priorSends.some(a => a.type === 'send_response' && a.status !== 'rejected')) fail(409, 'A delivery already exists for this campaign message. Reconcile it before any further action.');
    if (['executing', 'execution_uncertain', 'rejected'].includes(action.status) || ['sending', 'sent', 'uncertain'].includes(action.metadata?.campaign_delivery?.status) || ['SENT', 'SENDING', 'DELIVERY_UNCERTAIN'].includes(c.record.status)) fail(409, 'This campaign message was sent or its delivery needs reconciliation. It cannot be edited or retried.');
    const now = new Date().toISOString();
    if (command === 'save' || command === 'proposal') {
      const subject = String(body.subject || '').trim(), text = String(body.body || '');
      if (!subject || /[\r\n]/.test(subject) || !text.trim()) fail(400, 'A message and single-line subject are required');
      if (body.to !== undefined && body.to !== item.author_email) fail(400, 'Campaign recipients require separate contact verification');
      const metadata = { ...action.metadata, subject, campaign_review: { status: 'needs_review', edited_by: 'local-operator', edited_at: now, original_draft: action.metadata?.campaign_review?.original_draft || { subject: action.metadata.subject, body: action.body, receipt: action.result } } };
      delete metadata.revision_proposal;
      action = { ...action, body: text, metadata, approved_by: null, approved_at: null };
      await saveAction(root, action);
      await saveItem(root, { ...item, title: subject, body: text, normalized_text: text, updated_at: now, selected_action: action.id });
      c.record.approval_status = 'AWAITING_REVIEW';
      c.record.operator_edit = { subject, body: text, edited_at: now };
    } else if (command === 'approve') {
      if (body.reviewed !== true) fail(400, 'Review the recipient, subject and message before approving');
      if (action.metadata?.revision_proposal) fail(400, 'Save the proposed edits before approving');
      await checkDeliveryEligibility(root, action, item, c);
      action = { ...action, approved_by: 'local-operator', approved_at: now, metadata: { ...action.metadata, campaign_review: { ...action.metadata?.campaign_review, status: 'approved', approved_by: 'local-operator', approved_at: now, content_hash: campaignMessageHash(c.source, action, item), review_kind: 'explicit_operator_review' } } };
      await saveAction(root, action);
      c.record.approval_status = 'APPROVED';
    } else if (command === 'send') {
      if (body.confirm !== true) fail(400, 'Confirm the recipient and approved message before sending');
      const accountSourceIds = (await loadSources(root)).filter(s => s.type === 'email' && s.config?.username?.toLowerCase() === c.source.config?.username?.toLowerCase()).map(s => s.id);
      checkOutreachLimits(await readJson(join(root, 'outreach-limits.json'), null), await listActions(root), accountSourceIds, 1);
      await checkDeliveryEligibility(root, action, item, c);
      const hash = campaignMessageHash(c.source, action, item);
      if (action.metadata?.revision_proposal || action.metadata?.campaign_review?.status !== 'approved' || action.metadata.campaign_review.content_hash !== hash) fail(400, 'Approve this exact saved message before sending');
      // Persist intent before SMTP. A crash at any later point cannot resend.
      const policy = evaluatePolicy({ item, actionType: 'send_response', source: c.source, policies: await loadPolicies(root), settings: await loadSettings(root) });
      action = { ...action, metadata: { ...action.metadata, campaign_delivery: { status: 'sending', content_hash: hash, confirmed_by: 'local-operator', confirmed_at: now, authorization: 'explicit_manual_campaign_send', automation_policy_snapshot: policy } } };
      await saveAction(root, action);
      c.record.status = 'SENDING'; c.record.delivery = action.metadata.campaign_delivery;
      await writeJsonAtomic(join(c.base, 'state.json'), c.state);
      await logEvent(root, 'audit', { event_type: 'campaign_send_confirmed', action_id: id, item_id: item.id, status: 'sending' });
      let receipt;
      try {
        receipt = await sendEmailResponse(c.source, action, item, { kind: 'confirmed-campaign-send', content_hash: hash });
        if (!receipt.accepted?.some(address => String(address).toLowerCase() === item.author_email.toLowerCase()) || receipt.rejected?.length) throw new Error('SMTP did not confirm acceptance');
      } catch {
        action = { ...action, metadata: { ...action.metadata, campaign_delivery: { ...action.metadata.campaign_delivery, status: 'uncertain', failed_at: new Date().toISOString() } } };
        await saveAction(root, action);
        c.record.status = 'DELIVERY_UNCERTAIN'; c.record.delivery = action.metadata.campaign_delivery;
        await writeJsonAtomic(join(c.base, 'state.json'), c.state);
        await logEvent(root, 'audit', { event_type: 'campaign_delivery_uncertain', action_id: id, item_id: item.id, status: 'uncertain' });
        return { action, version: version(action) };
      }
      action = { ...action, metadata: { ...action.metadata, campaign_delivery: { ...action.metadata.campaign_delivery, status: 'sent', sent_at: new Date().toISOString(), receipt } } };
      await saveAction(root, action);
      c.record.status = 'SENT'; c.record.delivery = action.metadata.campaign_delivery;
      await saveItem(root, { ...item, status: 'resolved', queue: 'resolved', updated_at: new Date().toISOString() });
    } else fail(400, 'Use Save draft, Approve draft or Send email for campaign messages');
    c.state.events.push({ at: now, event: 'operator_campaign_' + command, action_id: id, prospect_id: c.prospect.canonical_id });
    await writeJsonAtomic(join(c.base, 'state.json'), c.state);
    await logEvent(root, 'audit', { event_type: 'operator_campaign_' + command, action_id: id, item_id: item.id, status: action.metadata.campaign_delivery?.status || action.metadata.campaign_review?.status });
    return { action, version: version(action) };
  }));
}
