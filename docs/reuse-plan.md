# Reuse Plan

## Reused by pattern

- RunLedger-style file-backed local state.
- Eval-style repeatable command-driven checks.
- Kujo CLI convention of explicit subcommands and inspectable artifacts.

## Not reused directly

No local TotalRecall or Strata implementation was available. Intake uses stable file contracts for future integration.

## Future extraction candidates

- Redaction helpers.
- JSONL audit writer.
- Local artifact manifest generator.
- Source adapter capability contract.
- TotalRecall export schema.
