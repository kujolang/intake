const MAX_SOURCE_HISTORY = 20;

export function appendSourceTestHistory(source, result, testedAt) {
  return appendSourceHistory(source, "test_history", {
    at: testedAt,
    ok: result.ok === true,
    errors: result.errors || [],
    checks: summarizeChecks(result.checks || {})
  });
}

export function appendSourceSyncHistory(source, result, syncedAt) {
  return appendSourceHistory(source, "sync_history", {
    at: syncedAt,
    ok: result.ok === true,
    saved_count: Number(result.saved_count || 0),
    cursor: result.cursor || null,
    errors: result.errors || []
  });
}

function appendSourceHistory(source, key, entry) {
  const history = Array.isArray(source[key]) ? source[key] : [];
  return {
    ...source,
    [key]: [entry, ...history].slice(0, MAX_SOURCE_HISTORY)
  };
}

function summarizeChecks(checks) {
  return Object.fromEntries(Object.entries(checks).map(([name, check]) => [
    name,
    {
      ok: check.ok === true,
      skipped: check.skipped === true,
      host: check.host || null,
      port: check.port || null,
      error: check.error || (check.errors || []).join("; ") || null
    }
  ]));
}
