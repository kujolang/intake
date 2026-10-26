import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore, saveSources, loadAction, saveAction, saveItem } from '../src/storage.js';
import { makeSource, makeItem } from '../src/models.js';
import { draftCampaign, parseResearchCsv, normalizeCollection } from '../src/outreach.js';
import { sendEmailResponse, appendEmailDraft } from '../src/adapters/email.js';
import { writeJsonAtomic } from '../src/util.js';
const p = { canonical_id: 'ASH-TEST', name: 'Specific Gym', email: 'owner@example.com', original_ids: ['ASH-TEST'], identity_terms: ['Specific Gym'], subject: 'First visit', body: 'Reviewed content', eligible: true, contact_status: 'VERIFIED', sources: ['https://example.com/contact'], qa: { passed: true } };
const config = () => ({ id: 'TEST-001', mode: 'DRAFT', sending_authorized: false, source_id: 'test-mail', sender_email: 'sender@example.com', prospects: [structuredClone(p)] });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'intake-outreach-'));t.after(() => rm(root, { recursive: true, force: true }));
  await initStore(root);await saveSources(root, [makeSource('email', { id: 'test-mail', config: { username: 'sender@example.com' } })]);
  return root;
}
const clear = async () => ({ complete: true, matches: [], folders: [{ mailbox: 'INBOX' }, { mailbox: 'Sent' }, { mailbox: 'Drafts' }] });
test('CSV preserves escaped quotes, multiline source details, BOM and identities', () => {
  const rows = parseResearchCsv('\uFEFF"prospect_id","research_collection","source_details"\r\n"one","Fitness","a, b\n""quote"""\r\n"two","Other","x"\r\n');
  assert.equal(rows[0].source_details, 'a, b\n"quote"');
  assert.equal(normalizeCollection(rows, 'Fitness').length, 1);
  assert.throws(() => normalizeCollection(rows, 'Fitness', [{ ids: ['one', 'two'], reason: 'bad scope' }]));
  assert.throws(() => parseResearchCsv('prospect_id\na\na\n'));
});
test('simulated successful append persists draft receipt; restart never duplicates', async t => {
  const root = await fixture(t);let appends = 0;
  const execute = async id => { appends++;const a = await loadAction(root, id);a.status = 'executed';a.result = { appended_to: 'Drafts', uid: '42' };await saveAction(root, a);return a; };
  const first = await draftCampaign(root, config(), { history: clear, execute });
  assert.equal(first.prospects[p.canonical_id].status, 'DRAFTED');
  const second = await draftCampaign(root, config(), { history: () => { throw Error('must not rescan existing'); }, execute });
  assert.equal(second.prospects[p.canonical_id].receipt.uid, '42');assert.equal(appends, 1);
  const changed = config();changed.prospects[0].body = 'changed';await assert.rejects(draftCampaign(root, changed), /campaign changed/);
});
test('send adapter blocks campaign items even when action metadata is removed', async () => {
  await assert.rejects(sendEmailResponse({}, { metadata: {} }, { metadata: { outreach: { mode: 'DRAFT' } } }), /disabled/);
  await assert.rejects(sendEmailResponse({}, { metadata: { outreach: {} } }, {}), /disabled/);
});
test('draft append refuses held review proposals before connecting', async () => {
  await assert.rejects(appendEmailDraft({}, { metadata: { outreach: { holds: ['unverified'] } } }, {}), /held/);
});
for (const scenario of ['missing contact', 'unverified contact', 'suppression', 'remote history', 'local customer', 'history failure']) test(`holds ${scenario} without an append`, async t => {
  const root = await fixture(t);const c = config();let history = clear;
  if (scenario === 'missing contact') { c.prospects[0].email = null;c.prospects[0].eligible = false; }
  if (scenario === 'unverified contact') { c.prospects[0].contact_status = 'UNKNOWN';c.prospects[0].eligible = false; }
  if (scenario === 'suppression') await writeJsonAtomic(join(root, 'outreach-suppressions.json'), [{ identity: p.email, reason: 'opt out' }]);
  if (scenario === 'remote history') history = async () => ({ complete: true, matches: [{ mailbox: 'Sent', uid: '5' }] });
  if (scenario === 'local customer') await saveItem(root, makeItem({ title: 'Specific Gym customer', body: 'active customer' }));
  if (scenario === 'history failure') history = async () => { throw Error('offline'); };
  const result = await draftCampaign(root, c, { history, execute: () => { throw Error('must never append'); } });
  assert.notEqual(result.prospects[p.canonical_id].status, 'DRAFTED');assert.ok(result.prospects[p.canonical_id].holds.length);
});
test('uncertain append never retries on restart and remains unsent', async t => {
  const root = await fixture(t);let calls = 0;
  const execute = async () => { calls++;throw Error('connection lost after append'); };
  const first = await draftCampaign(root, config(), { history: clear, execute });assert.equal(first.prospects[p.canonical_id].status, 'ERROR');
  await draftCampaign(root, config(), { history: clear, execute });assert.equal(calls, 1);
});
test('YOLO, APPROVED, sending authorization and wrong mailbox fail closed', async t => {
  const root = await fixture(t);
  for (const mode of ['YOLO', 'APPROVED']) await assert.rejects(draftCampaign(root, { ...config(), mode }), /only DRAFT/);
  await assert.rejects(draftCampaign(root, { ...config(), sending_authorized: true }), /only DRAFT/);
  await assert.rejects(draftCampaign(root, { ...config(), sender_email: 'other@example.com' }), /mailbox/);
});

test('explicit alias groups retain all records without merging common names', () => {
  const rows = [{prospect_id:'a',research_collection:'Fitness',business_name:'Same Gym'}, {prospect_id:'b',research_collection:'Fitness',business_name:'Same Gym'}, {prospect_id:'c',research_collection:'Fitness',business_name:'Alias Gym'}];
  assert.equal(normalizeCollection(rows,'fitness').length,3);
  const groups = normalizeCollection(rows,'fitness',[{ids:['a','c'],reason:'Verified shared address and operator'}]);
  assert.equal(groups.length,2);assert.deepEqual(groups[0].original_ids,['a','c']);assert.equal(groups.flatMap(g=>g.records).length,3);
});
