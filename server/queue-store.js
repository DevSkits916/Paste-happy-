import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATES = new Set(['pending', 'processing', 'posted', 'failed', 'blocked', 'uncertain', 'skipped']);
const RETRYABLE = new Set(['failed', 'blocked', 'uncertain', 'skipped']);

export class QueueStore {
  constructor(filePath) { this.filePath = filePath; this.state = emptyState(); this.writeChain = Promise.resolve(); }
  async init() {
    try { this.state = { ...emptyState(), ...JSON.parse(await readFile(this.filePath, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await this.persist(); }
    for (const job of this.state.jobs) if (job.status === 'processing') Object.assign(job, { status: 'failed', lastError: 'BROWSER_ERROR: Application stopped while processing.', updatedAt: new Date().toISOString() });
    await this.persist(); return this;
  }
  list() { return this.state.jobs.map((job) => ({ ...job })); }
  get(id) { const job = this.state.jobs.find((item) => item.id === id); return job ? { ...job } : null; }
  async import(rows) {
    let created = 0; let duplicates = 0;
    for (const row of rows) {
      if (!row.groupUrl || !row.postText) continue;
      const fingerprint = makeFingerprint(row);
      if (this.state.jobs.some((job) => job.fingerprint === fingerprint && job.status !== 'skipped')) { duplicates += 1; continue; }
      const now = new Date().toISOString();
      this.state.jobs.push({ id: randomUUID(), groupName: row.groupName || row.groupUrl, groupUrl: row.groupUrl, postText: row.postText, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, postedAt: null, lastError: null, fingerprint });
      created += 1;
    }
    await this.persist(); return { created, duplicates, total: this.state.jobs.length };
  }
  async transition(id, status, patch = {}) {
    if (!STATES.has(status)) throw new Error(`Invalid queue status: ${status}`);
    const job = this.state.jobs.find((item) => item.id === id); if (!job) return null;
    Object.assign(job, patch, { status, updatedAt: new Date().toISOString() });
    if (status === 'posted') job.postedAt ||= job.updatedAt;
    await this.persist(); return { ...job };
  }
  async claimNext() {
    const job = this.state.jobs.find((item) => item.status === 'pending');
    if (!job) return null;
    return this.transition(job.id, 'processing', { attempts: job.attempts + 1, lastError: null });
  }
  async retry(id) {
    const job = this.state.jobs.find((item) => item.id === id);
    if (!job) return null; if (!RETRYABLE.has(job.status)) throw new Error(`Cannot retry a ${job.status} job`);
    return this.transition(id, 'pending', { lastError: null, postedAt: null });
  }
  async skip(id) { return this.transition(id, 'skipped'); }
  async clear() { const cleared = this.state.jobs.length; this.state.jobs = []; await this.persist(); return { cleared }; }
  async persist() {
    const snapshot = JSON.stringify(this.state, null, 2); const target = this.filePath;
    this.writeChain = this.writeChain.then(async () => { await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.tmp`; await writeFile(temp, snapshot); await rename(temp, target); });
    return this.writeChain;
  }
}

function emptyState() { return { version: 1, jobs: [] }; }
function makeFingerprint(row) { return createHash('sha256').update(`${row.groupUrl.trim().replace(/\/$/, '').toLowerCase()}\0${row.postText.trim()}`).digest('hex'); }
