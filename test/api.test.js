import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QueueStore } from '../server/queue-store.js';
import { createApp } from '../server/app.js';

test('queue API imports CSV and supports get, skip, and retry', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'paste-api-')); const store = await new QueueStore(path.join(dir, 'q.json')).init();
  const worker = { status: () => ({ state: 'idle' }), start: () => true, pause() {}, resume() {}, stop() {} }; const browser = { exists: async () => false, context: null, login: async () => ({ opened: true }) };
  const server = createApp({ store, worker, browser, root: dir }).listen(0); await new Promise((r) => server.once('listening', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/queue/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: 'group,url,post\nOne,https://facebook.com/groups/1,Hi' }) }); assert.equal(response.status, 201);
  const [job] = await (await fetch(`${base}/api/queue`)).json(); assert.equal(job.groupName, 'One'); assert.equal('cookies' in job, false);
  response = await fetch(`${base}/api/queue/${job.id}/skip`, { method: 'POST' }); assert.equal((await response.json()).status, 'skipped');
  response = await fetch(`${base}/api/queue/${job.id}/retry`, { method: 'POST' }); assert.equal((await response.json()).status, 'pending');
});
