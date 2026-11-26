# TotalRecall Integration

`intake totalrecall export` writes a versioned JSON payload for memory-worthy records:

- Resolved or blocked items.
- Items with learning flags.
- Reviewed/proposed learnings.
- Summaries, outcomes, tags, queues, and risk.

TotalRecall remains responsible for recall and durable memory.

`--date` accepts a calendar date in `YYYY-MM-DD` format. On POSIX, exported files are private to the operator (`0600`), including replacements.
