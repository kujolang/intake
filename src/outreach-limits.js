// Called under the shared store/action locks before any campaign SMTP attempt.
export function checkOutreachLimits(config, actions, sourceId, requested, now = new Date()) {
  if (config == null) return;
  if (!Number.isSafeInteger(config.daily_limit) || config.daily_limit < 1 ||
      !Number.isSafeInteger(config.batch_limit) || config.batch_limit < 1 ||
      typeof config.timezone !== 'string') throw new Error('invalid outreach limits');
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const today = day(now);
  if (requested > config.batch_limit) throw new Error('outreach batch limit reached');
  const attempts = actions.filter(a => a.source_id === sourceId && a.metadata?.outreach && (
    a.type === 'send_response' && ['executing', 'executed', 'execution_uncertain'].includes(a.status) ||
    ['sending', 'sent', 'uncertain'].includes(a.metadata?.campaign_delivery?.status)));
  // Undated/uncertain attempts reserve capacity until reconciled, never permit a retry.
  const used = attempts.filter(a => {
    const at = a.metadata?.campaign_delivery?.sent_at || a.metadata?.campaign_delivery?.confirmed_at || a.executed_at || a.approved_at || a.created_at;
    return !at || !Number.isFinite(Date.parse(at)) || day(at) === today;
  }).length;
  if (used + requested > config.daily_limit) throw new Error(`outreach daily limit reached (${used}/${config.daily_limit}, ${today})`);
}
