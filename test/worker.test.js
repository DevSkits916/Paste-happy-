import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueWorker } from '../automation/queue-worker.js';

function fakeStore(jobs) { return { jobs, async claimNext() { const j = this.jobs.find((x) => x.status === 'pending'); if (!j) return null; j.status = 'processing'; j.attempts += 1; return { ...j }; }, async transition(id, status, patch = {}) { Object.assign(this.jobs.find((x) => x.id === id), patch, { status }); } }; }
test('a failed job does not kill the queue and a later job posts', async () => {
  const store = fakeStore([{ id: '1', status: 'pending', attempts: 0 }, { id: '2', status: 'pending', attempts: 0 }]);
  const worker = new QueueWorker({ store, browser: { page: async () => ({}), close: async () => {} }, poster: async (_p, job) => { if (job.id === '1') throw Object.assign(new Error('POST_FAILED: no'), { code: 'POST_FAILED' }); }, defaults: { defaultJobDelay: 0, maxJobsPerRun: 2 } });
  worker.start({ delayMs: 0 }); await worker.runPromise;
  assert.deepEqual(store.jobs.map((j) => j.status), ['failed', 'posted']);
});
test('an error after submit can remain uncertain without retry', async () => {
  const store = fakeStore([{ id: '1', status: 'pending', attempts: 0 }]);
  const worker = new QueueWorker({ store, browser: { page: async () => ({}) }, poster: async () => { throw Object.assign(new Error('POST_UNCERTAIN: verify'), { code: 'POST_UNCERTAIN' }); }, defaults: { defaultJobDelay: 0, maxJobsPerRun: 2 } });
  worker.start({ delayMs: 0 }); await worker.runPromise; assert.equal(store.jobs[0].status, 'uncertain'); assert.equal(store.jobs[0].attempts, 1);
});

test('skipping the current job closes its browser work and continues immediately', async () => {
  const store = fakeStore([{ id: '1', status: 'pending', attempts: 0 }, { id: '2', status: 'pending', attempts: 0 }]);
  let releaseFirst; let firstStarted;
  const firstStartedPromise = new Promise((resolve) => { firstStarted = resolve; });
  let browserClosed = 0;
  const worker = new QueueWorker({
    store,
    browser: { page: async () => ({}), close: async () => { browserClosed += 1; } },
    poster: async (_page, job) => { if (job.id === '1') { firstStarted(); await new Promise((resolve) => { releaseFirst = resolve; }); } },
    defaults: { defaultJobDelay: 0, maxJobsPerRun: 2 },
  });
  worker.start({ delayMs: 0 }); await firstStartedPromise;
  await worker.skipCurrent(); releaseFirst(); await worker.runPromise;
  assert.deepEqual(store.jobs.map((job) => job.status), ['skipped', 'posted']); assert.equal(browserClosed, 1);
});
