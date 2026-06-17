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
npm run bench -- --items 1000 --logs 10000 --fileRows 1000
npm run bench -- --items 10000 --logs 0 --fileRows 0
```

## Results

| Scenario | Timing |
| --- | ---: |
| Insert 1,000 items | 3,846 ms |
| Read item index page of 100 after 1,000-item setup | 976 ms |
| Write 10,000 audit logs | 9,370 ms |
| Sync 1,000 file rows | 10,332 ms |
| Repeated dedupe sync after 1,000 file rows | 1,265 ms |
| Insert 10,000 items | 37,535 ms |
| Read item index page of 100 after 10,000-item setup | 5,921 ms |
| No-op source sync after 10,000-item setup | 59 ms |
| Repeated no-op dedupe sync after 10,000-item setup | 58 ms |

## Notes

- Repeated no-op sync now uses compact item index dedupe keys and skips full index rebuilds when no items are saved.
- The 10,000-item index read includes first-read index rebuild cost in this benchmark shape because benchmark item insertion intentionally bypasses incremental index updates.
- File sync timing includes raw payload storage, item normalization, classification, audit logging, and final index rebuild for newly saved items.
- Next performance work should measure dashboard API latency against an already warm index and decide whether actions and learnings need compact indexes like items.
