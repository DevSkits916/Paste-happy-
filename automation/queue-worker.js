import { copyToSystemClipboard } from './clipboard.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class QueueWorker {
  constructor({ store, browser, poster, defaults }) { this.store = store; this.browser = browser; this.poster = poster; this.defaults = defaults; this.mode = 'idle'; this.currentJob = null; this.currentStep = 'Idle'; this.lastError = null; this.runPromise = null; this.skipRequested = new Set(); }
  status() { return { state: this.mode, currentJob: this.currentJob, currentStep: this.currentStep, lastError: this.lastError }; }
  start(options = {}) {
    if (this.runPromise) return false;
    this.options = { delayMs: this.defaults.defaultJobDelay, maxJobs: this.defaults.maxJobsPerRun, cooldownMs: 0, stopOnFailure: false, stopOnCheckpoint: true, ...options };
    this.mode = 'running'; this.runPromise = this.run().finally(() => { this.runPromise = null; if (this.mode !== 'stopped') this.mode = 'idle'; this.currentJob = null; }); return true;
  }
  pause() { if (this.runPromise) this.mode = 'paused'; }
  resume() { if (this.runPromise && this.mode === 'paused') this.mode = 'running'; }
  stop() { this.mode = 'stopped'; }
  async skipCurrent() {
    if (!this.runPromise || !this.currentJob) return null;
    const jobId = this.currentJob.id;
    this.skipRequested.add(jobId); this.currentStep = 'Skipping current group...';
    const skipped = await this.store.transition(jobId, 'skipped');
    await this.browser.close?.();
    return skipped;
  }
  async run() {
    let processed = 0;
    while (this.mode !== 'stopped' && processed < this.options.maxJobs) {
      while (this.mode === 'paused') await sleep(250);
      const job = await this.store.claimNext(); if (!job) break;
      this.currentJob = job; this.currentStep = 'Starting job...'; console.log(`[QUEUE] Starting job ${job.id}`);
      let skipped = false;
      try {
        this.currentStep = 'Copying post text to clipboard...';
        if (!(await copyToSystemClipboard(job.postText))) console.warn(`[QUEUE] ${job.id} could not copy text to the system clipboard; the browser fallback will be used.`);
        const page = await this.browser.page();
        await this.poster(page, job, (step) => { this.currentStep = step; console.log(`[FACEBOOK] ${step}`); });
        if (this.skipRequested.delete(job.id)) { skipped = true; console.log(`[QUEUE] Job ${job.id} skipped`); }
        else { await this.store.transition(job.id, 'posted'); console.log(`[QUEUE] Job ${job.id} marked posted`); }
      } catch (error) {
        if (this.skipRequested.delete(job.id)) { skipped = true; console.log(`[QUEUE] Job ${job.id} skipped`); }
        else {
          const code = error.code || 'BROWSER_ERROR'; const status = code === 'POST_UNCERTAIN' ? 'uncertain' : error.security ? 'blocked' : 'failed';
          this.lastError = error.message; await this.store.transition(job.id, status, { lastError: error.message }); console.error(`[QUEUE] ${job.id} ${error.message}`);
          if (this.options.stopOnFailure || (error.security && this.options.stopOnCheckpoint)) { this.mode = 'stopped'; break; }
        }
      }
      processed += 1; if (this.mode === 'running' && !skipped) await sleep(Math.max(this.options.delayMs, this.options.cooldownMs));
    }
  }
  async shutdown() { this.stop(); await this.runPromise?.catch(() => {}); await this.browser.close(); }
}
