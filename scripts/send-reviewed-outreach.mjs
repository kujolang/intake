import { readFile } from 'node:fs/promises';
import { loadDotEnvFiles } from '../src/secrets.js';
import { sendApprovedOutreach } from '../src/outreach-send.js';
const [flag, path, root = '.intake'] = process.argv.slice(2);
if (flag !== '--send' || !path) throw new Error('Usage: node scripts/send-reviewed-outreach.mjs --send PRIVATE_AUTHORIZATION_MANIFEST [STORE]');
loadDotEnvFiles({ intakeDir: root });
const result = await sendApprovedOutreach(root, JSON.parse(await readFile(path, 'utf8')));
console.log(JSON.stringify({ status: result.status, deliveries: result.deliveries }, null, 2));
