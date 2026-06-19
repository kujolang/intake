# Performance Baselines

These are local development baselines for detecting regressions. They are not vendor-neutral capacity guarantees.

## Environment

- Date: 2026-06-17
- OS: macOS Darwin 25.3.0
- CPU: Intel Core i7-9750H 2.60GHz
- Memory: 16 GB
- Node.js: v23.11.0
- npm: 10.9.2
- Storage: local temp directory under `/var/folders`

## Commands

```sh
npm run bench:gate
npm run bench -- --items 1000 --logs 10000 --fileRows 1000 --actions 1000 --learnings 1000
npm run bench -- --items 10000 --logs 0 --fileRows 0 --actions 1000 --learnings 1000
npm run bench -- --items 100 --logs 100000 --fileRows 0 --actions 0 --learnings 0 --dashboard false
```

`npm run bench:gate` runs a smaller repeatable benchmark and fails when warm dashboard reads or repeated no-op sync exceed release thresholds. Use the larger commands below it to refresh baseline evidence when storage, dashboard, or adapter behavior changes.

## Results

| Scenario | Timing |
| --- | ---: |
| Insert 1,000 items | 2,694 ms |
| Read item index page of 100 after 1,000-item setup | 440 ms |
| Insert 1,000 actions | 1,443 ms |
| Insert 1,000 learnings | 1,205 ms |
| Write 10,000 audit logs | 2,937 ms |
| Sync 1,000 file rows | 4,318 ms |
| Repeated dedupe sync after 1,000 file rows | 95 ms |
| Warm dashboard summary after 1k/1k/1k setup | 15 ms |
| Warm dashboard items page of 100 after 1k setup | 12 ms |
| Warm dashboard actions page of 100 after 1k setup | 33 ms |
| Warm dashboard learnings page of 100 after 1k setup | 52 ms |
| Warm dashboard approval audit after 1k setup | 122 ms |
| Insert 10,000 items | 21,192 ms |
| Read item index page of 100 after 10,000-item setup | 3,113 ms |
| No-op source sync after 10,000-item setup | 43 ms |
| Repeated no-op dedupe sync after 10,000-item setup | 44 ms |
| Warm dashboard summary after 10k items plus 1k actions/learnings | 55 ms |
| Warm dashboard items page of 100 after 10k setup | 51 ms |
| Warm dashboard actions page of 100 after 10k setup | 29 ms |
| Warm dashboard learnings page of 100 after 10k setup | 34 ms |
| Warm dashboard approval audit after 10k setup | 86 ms |
| Write 100,000 audit logs | 46,792 ms |

## Notes

- Repeated no-op sync now uses compact item index dedupe keys and skips full index rebuilds when no items are saved.
- The 10,000-item index read includes first-read index rebuild cost in this benchmark shape because benchmark item insertion intentionally bypasses incremental index updates.
- File sync timing includes raw payload storage, item normalization, classification, audit logging, and final index rebuild for newly saved items.
- Warm dashboard item, action, learning, summary, and approval-audit reads use compact indexes and now stay below 125 ms in these local baseline runs.
- Warm item, action, and learning index reads preserve write-time sort order instead of re-sorting every request; keep rebuild and upsert paths sorted when changing index storage.
- The 100,000 audit-log write baseline remains intentionally separate because it measures append-only log throughput rather than dashboard read latency.
