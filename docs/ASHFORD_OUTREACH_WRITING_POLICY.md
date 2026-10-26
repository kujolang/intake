# Ashford Software outreach writing policy

Version: **ashford-outreach/1.0.0**. Effective October 26, 2026.
Applies to **every Ashford outreach campaign**, including initial messages and
follow-up proposals, unless Robert explicitly overrides a writing preference.
Sending authorization, factual accuracy, suppression and contact verification
remain separate requirements. This policy supplements the installed
`orwell-writing` skill; it does not replace or modify that skill.

## Commercial judgment

Write as an experienced developer and business owner addressing another owner.
Use Ogilvy's specificity and attention to customer benefit with consultative
selling. Sell a worthwhile improvement in customer experience or business
operations, not a list of pages, buttons, forms or hours. A technical defect may
start the conversation, but explain why addressing it could matter. Never invent
lost revenue, abandoned inquiries, experience, credentials or client results.

Before writing, choose the actual angle: verified website issue, customer
conversion opportunity, workflow improvement, confusing customer experience,
missing/outdated digital presence, useful idea, helpful warning, or an honest
question about an unknown process. An already functioning funnel calls for a
different message than a verified defect. A helpful warning can stand alone
without a sales pitch.

## Write the message

1. Open with a specific, verified observation about this business. No generic
   company introduction, flattery or invented familiarity. Reviewing its public
   website permits saying you looked at the site; it does not imply a visit.
2. Connect the observation to a plausible customer or operational implication.
   Mark unproven impacts as possibilities: could, might, opportunity. Separate
   what was seen from what is inferred. Never disguise a hypothesis as a defect.
3. Explain one credible business opportunity. Do not minimize it as a small
   cleanup or reduce the offer to fixing a dropdown. Describe the experience or
   process that deserves attention without exaggerating its scope.
4. Introduce Ashford naturally if needed. Vary placement and omit redundant
   introductions. Do not claim years of experience without evidence.
5. Finish with one natural question about that opportunity. Ask about their
   plans, process or interest; do not force a meeting or urgency. Avoid identical
   CTAs and confrontational questions.

Use conversational American English, contractions, short paragraphs and plain
words. Aim for 75–130 words excluding signature and compliance footer. Apply
Orwell's meaning/structure/words/voice/compression/naturalness review. No emojis,
corporate jargon, exaggerated claims or unnecessary technical detail. Prefer
short, specific, personal-sounding subjects; no clickbait or generic sales
headlines. Do not repeatedly use “Quick question.”

Reject phrases such as “I could help tidy up,” “I can fix that for you,” “would
that be useful,” “would you like help with your website,” “I'd be happy to,” “just
reaching out,” “I wanted to introduce myself,” “full-service agency,” “small
cleanup” and “just a quick fix.” A narrow practical offer is welcome when its
business relevance is clear.

## Required review before persistence

Score each dimension from 0 to 5, with a rationale:

| Dimension | What a strong score means |
| --- | --- |
| Specificity | Cannot be sent unchanged to another business |
| Accuracy | Every material observation has dated, attributable evidence |
| Insight | Explains a meaningful customer/operational consideration |
| Value | Makes one credible improvement understandable |
| Voice | Sounds like natural correspondence from Robert |
| Confidence | Direct without begging, boasting or presuming a problem |
| Closing | One useful question tied to the opportunity |
| Distinctiveness | Insight and construction differ from neighboring drafts |

Require **34/40**, **accuracy 5/5**, and insight/value at least 4/5. Any unsupported
material claim fails regardless of total. Scores are reviewer judgments, not
objective predictions of sales success. Contact eligibility is independent: a
well-written, accurate conditional proposal can remain unaddressed and blocked.

Maintain a claim ledger with exact copy spans, VERIFIED or INFERRED status,
source URL, verification date and reviewer confirmation. Verify that the ledger
covers **all** material claims; automated matching cannot establish truth or
completeness. A fetched error page proves only an error at that time, not a
closure, domain takeover or malicious compromise.

Compare the complete campaign before saving. Reconsider repeated opening
phrases, sentence patterns, company introductions, paragraph progression and
closing questions. Do not force synonyms to evade checks: uniqueness must come
from business-specific insight. Record distinctiveness notes and a human/agent
reviewer attestation of structural review against the batch hash.

`src/outreach-copy.js` enforces schema, minimum scores, claim references,
content/batch review hashes, length, question count, known weak language and
repeated text. It cannot independently verify public facts or judge every form
of formulaic prose. Manual semantic review remains mandatory. Tests deliberately
cover unacceptable drafts, not merely clean examples.

## Editing and continuity

Preserve local Intake action/item IDs. Reset send approval on any change, keep
versioned prior copy and evidence, and record mailbox replacement receipts.
IMAP message bodies are immutable: a revision may need a new UID/Message-ID.
Read back the replacement, then move the known old draft to a recoverable
revision archive. Never delete unrelated mail or leave two active versions in
Drafts. Stop on uncertainty instead of blindly retrying. Recheck holds and
history; editing copy does not authorize sending or cure a missing contact.

The initiating authority is Robert's October 26, 2026 “Outreach Copy Upgrade”
instructions and five rewritten Campaign 001 examples. Store actual prospect
research and drafts privately in `.intake/`, not in this public policy.

## Subject and Intake title clarification (October 26, 2026)

Use the natural email subject as the Intake item title, too. Never prefix either
with a campaign ID, batch ID, business-name label or internal tracking text.
Keep campaign identity in tags and metadata. Robert explicitly rejected titles
such as “ASH-FIT-001 — Business: Question about your website.”
