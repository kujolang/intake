import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOutreachLimits } from '../src/outreach-limits.js';
const config = {daily_limit: 10, batch_limit: 5, timezone: 'America/Detroit'};
const now = new Date('2026-10-27T02:00:00Z'); // Still October 26 in Detroit.
const sent = (n, status = 'executed') => Array.from({length:n}, (_,i) => ({
  id:String(i), source_id:'mail', type:'send_response', status,
  metadata:{outreach:{campaign_id: i % 2 ? 'OLD' : 'NEW'}}, approved_at:'2026-10-26T18:00:00Z'
}));
test('limits count all campaigns on the same account, including uncertain attempts', () => {
  assert.throws(() => checkOutreachLimits(config, sent(10), 'mail', 1, now), /daily limit/);
  assert.throws(() => checkOutreachLimits(config, sent(6, 'execution_uncertain'), 'mail', 5, now), /daily limit/);
  checkOutreachLimits(config, sent(5), 'mail', 5, now);
  checkOutreachLimits(config, sent(10), 'other-mail', 1, now);
});
test('local midnight resets allowance; batch and invalid configurations fail closed', () => {
  checkOutreachLimits(config, sent(10), 'mail', 1, new Date('2026-10-27T04:01:00Z'));
  assert.throws(() => checkOutreachLimits(config, [], 'mail', 6, now), /batch limit/);
  assert.throws(() => checkOutreachLimits({...config,daily_limit:0}, [], 'mail', 1, now), /invalid/);
  assert.throws(() => checkOutreachLimits({...config,timezone:'invalid'}, [], 'mail', 1, now));
});
test('dashboard deliveries count once, while archived draft receipts do not double-count', () => {
  const manual = {...sent(1)[0],type:'draft_response',metadata:{outreach:{},campaign_delivery:{status:'sent',sent_at:'2026-10-26T19:00:00Z'}}};
  const archived = {...sent(1)[0],type:'draft_response',metadata:{outreach:{},delivery:{sent_copy_verified:true}}};
  const limit = {...config,daily_limit:1};
  assert.throws(() => checkOutreachLimits(limit,[manual], 'mail',1,now), /daily limit/);
  checkOutreachLimits(limit,[archived], 'mail',1,now);
});
test('actual submission time takes precedence over stale approval and source aliases share capacity', () => {
  const pending = {...sent(1,'execution_uncertain')[0],source_id:'alias',approved_at:'2026-10-01T00:00:00Z',metadata:{outreach:{},outreach_attempted_at:'2026-10-26T19:00:00Z'}};
  assert.throws(() => checkOutreachLimits({...config,daily_limit:1},[pending],['mail','alias'],1,now), /daily limit/);
});
