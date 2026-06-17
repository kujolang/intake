# Intake Existing Systems Audit

Date: 2026-06-16

## Scope

The local workspace was inspected before building Intake. The `intake` repo was empty. Nearby Kujo repositories available locally included `kujo`, `runledger`, `spec`, `eval`, `lens`, `agents-sdk`, `ai-sdk`, `casefile`, `patchbrief`, `shipcheck`, and other ecosystem tools.

No local `TotalRecall` or `Strata` repository was found under `/Users/robertdevore/2026/Kujolang` during this audit.

## What TotalRecall already does that Intake can reuse

No local TotalRecall source was available to inspect. Intake therefore defines stable file exports rather than importing or duplicating TotalRecall internals. The reusable contract is the product boundary: TotalRecall should receive resolved item summaries, final outcomes, approved learnings, repeated patterns, and daily summaries.

## What TotalRecall does that Intake should not own

Intake should not own long-term memory, transcript recall, historical search, organizational knowledge retrieval, or trusted memory mutation. Intake may export approved records to TotalRecall but should not become a recall engine.

## Shared primitives that should exist

- Local-first filesystem storage.
- JSON and Markdown artifact contracts.
- JSONL audit logs.
- Deterministic command outputs for automation.
- Redaction helpers for secrets and auth-bearing logs.
- Release/eval style checks similar to `eval` and `shipcheck`.

## Intake-specific responsibilities

- Active inbound queues.
- Source adapters.
- Raw payload preservation.
- Normalization into `IntakeItem`.
- Routing, risk, and policy decisions.
- Draft/action approval workflow.
- Local webhook receiver.
- Email IMAP/SMTP operation behind policy gates.

## TotalRecall-specific responsibilities

- Memory-worthy record retention.
- Recall over what happened and what was decided.
- Historical context for future agents.
- Trusted knowledge search.

## Built from scratch

Because the repo was empty and TotalRecall/Strata were not locally available, Intake now includes its own small Node CLI, local storage, adapters, rules, policy engine, action workflow, exports, docs, and evals.

## Reuse/mirroring decisions

- Mirrored RunLedger's explicit local directory style and atomic record writes.
- Mirrored Eval's CLI/eval separation and deterministic command philosophy.
- Mirrored Spec's emphasis on documented command inventory and contract clarity.
- Kept Strata and TotalRecall integrations file-based.
