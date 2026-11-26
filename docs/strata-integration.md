# Strata Integration

`intake strata daily` writes a Markdown daily note with inbound volume, queues, tags, FAQ candidates, regressions, support friction, bottlenecks, suggested rules, and knowledge updates.

The default output is `.intake/strata/daily/intake-learnings-YYYY-MM-DD.md`.

`--date` accepts a calendar date in `YYYY-MM-DD` format. On POSIX, exported files are private to the operator (`0600`), including replacements. Incoming text is rendered as single-line literal evidence inside the Markdown report.

General and custom learning types appear under **Other learnings**, so every learning marked exported is represented in the note.
