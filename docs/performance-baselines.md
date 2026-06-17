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
npm run bench -- --items 1000 --logs 10000 --fileRows 1000 --actions 1000 --learnings 1000
npm run bench -- --items 10000 --logs 0 --fileRows 0 --actions 1000 --learnings 1000
npm run bench -- --items 100 --logs 100000 --fileRows 0 --actions 0 --learnings 0 --dashboard false
```

## Results

| Scenario | Timing |
| --- | ---: |
| Insert 1,000 items | 4,398 ms |
| Read item index page of 100 after 1,000-item setup | 586 ms |
| Insert 1,000 actions | 2,176 ms |
| Insert 1,000 learnings | 2,562 ms |
| Write 10,000 audit logs | 5,628 ms |
| Sync 1,000 file rows | 7,080 ms |
| Repeated dedupe sync after 1,000 file rows | 124 ms |
| Warm dashboard summary after 1k/1k/1k setup | 421 ms |
| Warm dashboard items page of 100 after 1k setup | 12 ms |
| Warm dashboard actions page of 100 after 1k setup | 271 ms |
| Warm dashboard learnings page of 100 after 1k setup | 308 ms |
| Warm dashboard approval audit after 1k setup | 404 ms |
| Insert 10,000 items | 35,378 ms |
| Read item index page of 100 after 10,000-item setup | 2,927 ms |
| No-op source sync after 10,000-item setup | 54 ms |
| Repeated no-op dedupe sync after 10,000-item setup | 62 ms |
| Warm dashboard summary after 10k items plus 1k actions/learnings | 576 ms |
| Warm dashboard items page of 100 after 10k setup | 86 ms |
| Warm dashboard actions page of 100 after 10k setup | 559 ms |
| Warm dashboard learnings page of 100 after 10k setup | 599 ms |
| Warm dashboard approval audit after 10k setup | 877 ms |
| Write 100,000 audit logs | 46,792 ms |

## Notes

- Repeated no-op sync now uses compact item index dedupe keys and skips full index rebuilds when no items are saved.
- The 10,000-item index read includes first-read index rebuild cost in this benchmark shape because benchmark item insertion intentionally bypasses incremental index updates.
- File sync timing includes raw payload storage, item normalization, classification, audit logging, and final index rebuild for newly saved items.
- Warm dashboard item pages are served from the compact item index and stay materially faster than full action/learning reads.
- Action, learning, and approval-audit dashboard endpoints cross the 500 ms range at 10k items plus 1k related records. Next performance work should add compact indexes or purpose-built summaries for those records.
