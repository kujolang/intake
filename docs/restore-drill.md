# Restore Drill

Run this drill before relying on a production mailbox or team workflow.

## Goal

Prove that a backup can be created, verified, restored into a clean directory, and inspected without touching the active `.intake/` store.

## Steps

1. Create a backup.

   ```sh
   intake backup create --keep 7
   ```

2. Verify the backup archive.

   ```sh
   intake backup verify .intake/backups/intake-backup-YYYYMMDDHHMMSS.json.gz
   ```

3. Restore into a clean drill directory.

   ```sh
   rm -rf .intake-restore-drill
   intake backup restore .intake/backups/intake-backup-YYYYMMDDHHMMSS.json.gz --target .intake-restore-drill
   ```

4. Inspect the restored store without switching the live app.

   ```sh
   INTAKE_DIR=.intake-restore-drill intake doctor
   INTAKE_DIR=.intake-restore-drill intake items --limit 10
   INTAKE_DIR=.intake-restore-drill intake source list
   ```

5. Record the evidence.

   - Backup path.
   - Backup verify result.
   - Restore target.
   - `doctor` result for the restored store.
   - Screenshot of the restored dashboard or terminal output.

## Expected Result

- `backup verify` reports `OK`.
- Restore completes into the target directory.
- `doctor` can read schema metadata, config, sources, indexes, and logs.
- The restored dashboard can open with `INTAKE_DIR=.intake-restore-drill intake dashboard`.

## Notes

Backups exclude `.intake/.env` and `.intake/secrets/` by default. That is the safer operating mode. If you intentionally include secrets for an encrypted offsite backup process, document where the archive is stored, who can decrypt it, and how it is rotated.
