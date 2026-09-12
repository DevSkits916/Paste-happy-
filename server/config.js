import path from 'node:path';

const root = process.cwd();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const config = {
  port: number(process.env.PORT, 4173),
  dataPath: path.resolve(process.env.QUEUE_DATA_PATH || path.join(root, 'data', 'queue.json')),
  profilePath: path.resolve(process.env.BROWSER_PROFILE_PATH || path.join(root, '.browser-profile')),
  headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  defaultJobDelay: number(process.env.DEFAULT_JOB_DELAY, 15000),
  maxJobsPerRun: number(process.env.MAX_JOBS_PER_RUN, 10),
};
