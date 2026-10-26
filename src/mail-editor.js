import { editCampaignMail } from "./campaign-mail.js";
import { makeAction, makeItem } from './models.js';
import { loadAction, loadItem, loadSources, listActions, saveAction, saveItem, logEvent } from './storage.js';
import { sha256, stableStringify } from './util.js';
import { approveAction, runAction } from './workflow.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { statusCode: status }); };
export const mailVersion = action => sha256(stableStringify(action));
const locked = action => ['executing', 'execution_uncertain', 'rejected'].includes(action.status) || (action.status === 'executed' && action.type !== 'draft_response');

export async function itemMail(root, id) {
  const item = await loadItem(root, id);
  if (!item) fail(404, 'No such item');
  const actions = (await listActions(root, { intake_item_id: id })).filter(a => ['draft_response', 'send_response'].includes(a.type));
  return { actions: actions.map(a => ({ ...a, version: mailVersion(a) })) };
}

function fields(body) {
  const to = String(body.to || '').trim(), subject = String(body.subject || '').trim(), text = String(body.body || '');
  if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(to)) fail(400, 'Enter one valid recipient email address');
  if (!subject || /[\r\n]/.test(subject)) fail(400, 'Enter a single-line subject');
  if (!text.trim()) fail(400, 'Enter a message');
  return { to, subject, text };
}

// Dashboard requests hold the store lock, including version checks and execution.
export async function editMail(root, command, id, body) {
  if (command === 'compose' || command === 'reply') {
    const { to, subject, text } = fields(body);
    const source = (await loadSources(root)).find(s => s.id === body.source_id && s.type === 'email' && s.enabled);
    if (!source) fail(400, 'Choose an enabled email account');
    const original = command === 'reply' ? await loadItem(root, body.item_id) : null;
    if (command === 'reply' && (!original || original.source_id !== source.id || original.metadata?.outreach)) fail(400, 'Invalid reply item');
    const item = original || makeItem({ source_id: source.id, source_type: 'email', title: subject, body: text, author_email: to, status: 'draft_ready', metadata: { composed: true } });
    const action = makeAction({ intake_item_id: item.id, source_id: source.id, type: 'draft_response', status: 'needs_review', body: text, proposed_by: 'dashboard', metadata: { to, subject, composed: !original } });
    await saveItem(root, { ...item, selected_action: action.id });
    await saveAction(root, action);
    return { item, action, version: mailVersion(action) };
  }
  const action = await loadAction(root, id);
  if (!action) fail(404, 'No such draft');
  if (body.version !== mailVersion(action)) fail(409, 'This draft changed. Reopen it before saving or sending. Your edits remain in the editor.');
  const item = await loadItem(root, action.intake_item_id);
  if (!item || !['draft_response', 'send_response'].includes(action.type)) fail(400, 'Not an email draft');
  const campaign = action.metadata?.outreach || item.metadata?.outreach;
  if (campaign) return editCampaignMail(root, command, id, body);
  if (locked(action)) fail(400, 'This message cannot be edited or sent; reconcile uncertain delivery before retrying');
  const source = (await loadSources(root)).find(s => s.id === action.source_id && s.type === 'email' && s.enabled);
  if (!source) fail(400, 'An enabled email account is required');
  if (command === 'send' || command === 'append') {
    if (body.confirm !== true) fail(400, 'Confirm the saved recipient and message before sending');
    if (action.status === 'executed') fail(400, 'Save a new local revision before sending a mailbox draft');
    fields({ to: action.metadata?.to || item.author_email, subject: action.metadata?.subject, body: action.body });
    // Preserve the action ID: repeated requests cannot create a second delivery.
    const next = { ...action, type: command === 'send' ? 'send_response' : 'draft_response', status: 'needs_review', approved_by: null, approved_at: null };
    await saveAction(root, next);
    await approveAction(root, id, 'dashboard');
    const sent = await runAction(root, id);
    return { action: sent, version: mailVersion(sent) };
  }
  if (command !== 'save') fail(404, 'Unknown mail command');
  const { to, subject, text } = fields(body);
  const next = action.status === 'executed'
    ? makeAction({ ...action, id: undefined, status: 'needs_review', type: 'draft_response', executed_at: null, result: null, approved_by: null, approved_at: null, metadata: { ...action.metadata, previous_draft_id: action.id } })
    : { ...action, status: 'needs_review', approved_by: null, approved_at: null };
  next.body = text;
  next.metadata = { ...next.metadata, to, subject };
  await saveAction(root, next);
  await saveItem(root, { ...item, ...(item.metadata?.composed ? { title: subject, body: text, normalized_text: text, author_email: to } : {}), selected_action: next.id, status: 'draft_ready' });
  await logEvent(root, 'audit', { event_type: 'mail_draft_saved', action_id: next.id, item_id: item.id });
  return { action: next, version: mailVersion(next) };
}
