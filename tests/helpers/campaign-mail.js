import { join } from 'node:path';
import { makeSource, makeItem, makeAction } from '../../src/models.js';
import { saveSources, saveItem, saveAction } from '../../src/storage.js';
import { writeJsonAtomic } from '../../src/util.js';

export async function seedCampaignMail(root, options = {}) {
  const source = makeSource('email', { id: 'mail', name: 'Test account', secret_ref: 'env:INTAKE_TEST_CAMPAIGN_PASSWORD', config: { username: 'sender@example.test' } });
  const outreach = { campaign_id: 'TEST-CAMPAIGN', canonical_id: 'TEST-PROSPECT', batch_id: null, holds: [], mode: 'DRAFT', send_blocked: true };
  const item = makeItem({ id: 'itm_campaign', source_id: source.id, source_type: 'email', title: 'Campaign preview', body: 'Original message', author_email: 'recipient@example.test', metadata: { outreach } });
  const action = makeAction({ id: 'act_campaign', intake_item_id: item.id, source_id: source.id, type: 'draft_response', status: 'executed', body: item.body, result: { uid: 42, mailbox: 'Drafts' }, metadata: { subject: 'Campaign preview', outreach } });
  const prospect = { canonical_id: outreach.canonical_id, eligible: true, contact_status: 'VERIFIED', email: item.author_email, identity_terms: ['Test business'], holds: [], subject: action.metadata.subject, body: action.body, ...options.prospect };
  const base = join(root, 'campaigns', outreach.campaign_id);
  await saveSources(root, [source]);
  await saveItem(root, { ...item, selected_action: action.id });
  await saveAction(root, action);
  await writeJsonAtomic(join(base, 'campaign.json'), { id: outreach.campaign_id, source_id: source.id, sender_email: source.config.username, prospects: [prospect] });
  await writeJsonAtomic(join(base, 'state.json'), { id: outreach.campaign_id, prospects: { [outreach.canonical_id]: { action_id: action.id, item_id: item.id, status: 'DRAFTED', holds: [], receipt: action.result } }, events: [] });
  return { source, item, action, prospect, base };
}
