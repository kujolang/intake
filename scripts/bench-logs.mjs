#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';

const root = await mkdtemp(join(tmpdir(), 'intake-log-bench-'));
let dashboard;
try {
  dashboard = await startDashboard(root, { port: 0, token: 'log-benchmark' });
  const rows = Array.from({ length: 100000 }, (_, id) => JSON.stringify({ id, message: 'Audit event '.repeat(16) }));
  const data = `${rows.join('\n')}\n`;
  await writeFile(join(root, 'logs', 'audit.jsonl'), data);
  const timings = [];
  let result;
  for (let n = 0; n < 6; n++) {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${dashboard.port}/api/logs?limit=200`, { headers: { 'x-intake-token': 'log-benchmark' } });
    if (!response.ok) throw new Error(`logs failed: ${response.status}`);
    result = await response.json();
    if (n) timings.push(Number((performance.now() - start).toFixed(2)));
  }
  if (result.logs.length !== 200 || result.logs[0].id !== 99999 || result.logs[199].id !== 99800) throw new Error('incorrect log page');
  console.log(JSON.stringify({ rows: rows.length, file_bytes: Buffer.byteLength(data), page_rows: result.logs.length, timings_ms: timings, median_ms: timings.slice().sort((a, b) => a - b)[2], response_bytes: Buffer.byteLength(JSON.stringify(result)) }, null, 2));
} finally {
  if (dashboard) await new Promise(resolve => dashboard.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
