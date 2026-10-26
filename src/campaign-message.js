import { sha256, stableStringify } from './util.js';

// Approval binds the complete outbound message and sending identity, not UI state.
export function campaignMessageHash(source, action, item) {
  return sha256(stableStringify({
    action_id: action.id, item_id: item.id, source_id: source.id,
    account: source.config?.username, from: source.config?.from || source.config?.username,
    to: item.author_email, subject: action.metadata?.subject, body: action.body,
    campaign: action.metadata?.outreach?.campaign_id,
    batch: action.metadata?.outreach?.batch_id || null,
    prospect: action.metadata?.outreach?.canonical_id
  }));
}

export function campaignSendAuthorized(source, action, item, authorization) {
  const review = action.metadata?.campaign_review;
  const delivery = action.metadata?.campaign_delivery;
  const hash = campaignMessageHash(source, action, item);
  return authorization?.kind === 'confirmed-campaign-send' && authorization.content_hash === hash &&
    review?.status === 'approved' && review.content_hash === hash &&
    delivery?.status === 'sending' && delivery.content_hash === hash &&
    delivery.confirmed_by === 'local-operator' && Boolean(delivery.confirmed_at);
}
