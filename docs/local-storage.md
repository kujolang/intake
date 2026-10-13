# Local Storage

State lives in `.intake/` by default:

- `config/*.json` for sources, rules, policies, agents, settings.
- `raw/` for original source payloads.
- `items/`, `actions/`, and `learnings/` for atomic JSON records.
- `logs/*.jsonl` for audit and operational logs.
- `strata/daily/` and `totalrecall/exports/` for integration artifacts.

Prefer environment or Keychain secret references. Legacy inline source credentials are supported, masked in source exports, and omitted from default backups.

All supported CLI operations, dashboard requests, receivers, maintenance, and storage APIs coordinate with an exclusive sibling `<store>.intake-lock` file. Independent operations in one process queue; another process fails before reading/writing with `INTAKE_STORE_BUSY` (HTTP 409 / CLI failure). Retry after the active operation completes. Locks cover config read/modify/write, sync, index updates, log retention, and backup snapshots. Restore retains its lock while replacing the store. This is cooperative local-filesystem isolation, not an ACID database or a network-filesystem guarantee. Older binaries and direct filesystem edits do not participate: stop them before upgrading.

After a crashed writer exits, run `intake store recover --dir PATH`. It refuses a live PID or another host, gates new operations, and rebuilds all three indexes from durable records before unlocking. There is no timed lease stealing. If ownership is unreadable, stop all writers, inspect the lock, then use `--force`; force never overrides a readable live owner. If recovery itself crashes, inspect `<store>.intake-recovery/owner.json` and remove that directory only after its process has exited, then rerun recovery. Parent-directory write permission is required.

Atomic record replacement remains the persistence unit. Multi-record failures can leave completed records; recovery does not roll back external effects or reconstruct a record that never reached disk. After disk errors, restore writable storage and run recovery before continuing. Action execution retains its separate `.action-lock`: reconcile `executing`/`execution_uncertain` actions and remote effects before removing that lock or reapproving an action. Store recovery never replays outbound operations.

Library consumers doing several related reads/writes should wrap them in `withStoreLock(root, async () => { ... })` from `src/store-lock.js`; nested storage calls reuse ownership. Await all work inside the callback; do not spawn detached writes. `save*(..., {rebuildIndex:false})` remains a batch API: rebuild the relevant index before the outer transaction ends. Individual load/save calls alone cannot make an application-level read/modify/write atomic.

Sync persists only successfully classified items, rebuilds its index even on provider failure, and advances the source cursor only on success. Retry dedupes the durable successes and reattempts failed items. Raw payloads from failed attempts may remain for retention cleanup.

Restore now records a sibling `<store>.intake-restore.json` journal before staging and before the directory swap. Normal operations refuse access while that journal remains. After confirming the writer has exited, `store recover` resolves the journal **before** initializing the store or rebuilding indexes: it discards incomplete staging, rolls back an interrupted swap to the previous store, or retains an already installed restore. For a previously absent target, a fully prepared restore is installed. Cleanup can be retried after interruption. Invalid or ambiguous journals preserve the trees and fail closed, including with `--force`; inspect those artifacts instead of deleting them. Restore through a symlink operates on its canonical store and preserves the alias. Older interrupted restores without journals still require manual inspection of `.previous-*` and `.restore-*` siblings; do not initialize a missing store until its original tree is located.

A partial final JSONL record is preserved as evidence on its own line when the next event is appended. The next event remains independently parseable. Writes are coordinated and atomically renamed where applicable, but are not fsync-based power-loss transactions; process-exit recovery does not promise durability against sudden power loss or failed storage hardware.
