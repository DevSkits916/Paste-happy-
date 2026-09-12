import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QueueStore } from '../server/queue-store.js';

async function store() { const dir = await mkdtemp(path.join(tmpdir(), 'paste-happy-')); return new QueueStore(path.join(dir, 'queue.json')).init(); }
const row = { groupName: 'One', groupUrl: 'https://facebook.com/groups/1', postText: 'Hello' };

test('creates, claims, persists, posts and protects duplicate jobs', async () => {
  const queue = await store(); assert.deepEqual(await queue.import([row, row]), { created: 1, duplicates: 1, total: 1 });
  const claimed = await queue.claimNext(); assert.equal(claimed.status, 'processing'); assert.equal(claimed.attempts, 1);
  const posted = await queue.transition(claimed.id, 'posted'); assert.ok(posted.postedAt);
  assert.equal((await queue.claimNext()), null); assert.equal(JSON.parse(await readFile(queue.filePath)).jobs[0].status, 'posted');
});

test('retry is manual and resets failed, blocked, uncertain, and skipped jobs', async () => {
  const queue = await store(); await queue.import([row]); const job = await queue.claimNext();
  await queue.transition(job.id, 'uncertain', { lastError: 'POST_UNCERTAIN' });
  assert.equal((await queue.claimNext()), null, 'uncertain jobs are not automatically duplicated');
  assert.equal((await queue.retry(job.id)).status, 'pending'); assert.equal((await queue.claimNext()).attempts, 2);
});

test('recovers an interrupted processing job as failed', async () => {
  const first = await store(); await first.import([row]); await first.claimNext();
  const recovered = await new QueueStore(first.filePath).init(); assert.equal(recovered.list()[0].status, 'failed');
});

test('clearing the queue removes every job', async () => {
  const queue = await store();
  await queue.import([{ groupName: 'One', groupUrl: 'https://facebook.com/groups/1', postText: 'Hello' }]);
  assert.deepEqual(await queue.clear(), { cleared: 1 }); assert.deepEqual(queue.list(), []);
});
