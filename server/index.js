import { config } from './config.js';
import { QueueStore } from './queue-store.js';
import { BrowserManager } from '../automation/browser.js';
import { postToFacebook } from '../automation/facebook.js';
import { QueueWorker } from '../automation/queue-worker.js';
import { createApp } from './app.js';

const store = await new QueueStore(config.dataPath).init();
const browser = new BrowserManager(config);
const worker = new QueueWorker({ store, browser, poster: postToFacebook, defaults: config });
const server = createApp({ store, worker, browser }).listen(config.port, () => console.log(`[SERVER] Paste Happy running at http://localhost:${config.port}`));
async function shutdown(signal) { console.log(`[SERVER] ${signal}, shutting down`); server.close(); await worker.shutdown(); process.exit(0); }
process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
