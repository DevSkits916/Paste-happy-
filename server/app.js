import express from 'express';
import path from 'node:path';
import { parseCsv } from './csv.js';

export function createApp({ store, worker, browser, root = process.cwd() }) {
  const app = express(); app.use(express.json({ limit: '5mb' }));
  app.get('/api/queue', (_req, res) => res.json(store.list()));
  app.get('/api/queue/:id', (req, res) => { const job = store.get(req.params.id); return job ? res.json(job) : res.status(404).json({ error: 'Job not found' }); });
  app.post('/api/queue/import', async (req, res, next) => { try { const rows = req.body.csv ? parseCsv(req.body.csv) : req.body.rows; if (!Array.isArray(rows)) return res.status(400).json({ error: 'Provide csv or rows' }); res.status(201).json(await store.import(rows)); } catch (e) { next(e); } });
  app.post('/api/queue/start', (req, res) => res.status(worker.start(req.body) ? 202 : 409).json(worker.status()));
  app.post('/api/queue/pause', (_req, res) => { worker.pause(); res.json(worker.status()); });
  app.post('/api/queue/resume', (_req, res) => { worker.resume(); res.json(worker.status()); });
  app.post('/api/queue/stop', (_req, res) => { worker.stop(); res.json(worker.status()); });
  app.post('/api/queue/current/skip', async (_req, res, next) => { try { const job = await worker.skipCurrent(); return job ? res.json(worker.status()) : res.status(409).json({ error: 'No current job to skip' }); } catch (e) { next(e); } });
  app.post('/api/queue/:id/retry', async (req, res, next) => { try { const job = await store.retry(req.params.id); return job ? res.json(job) : res.status(404).json({ error: 'Job not found' }); } catch (e) { next(e); } });
  app.post('/api/queue/:id/skip', async (req, res, next) => { try { const job = await store.skip(req.params.id); return job ? res.json(job) : res.status(404).json({ error: 'Job not found' }); } catch (e) { next(e); } });
  app.get('/api/status', async (_req, res) => res.json({ ...worker.status(), browser: { profileExists: await browser.exists(), open: Boolean(browser.context) } }));
  app.post('/api/browser/login', async (_req, res, next) => { try { res.status(202).json(await browser.login()); } catch (e) { next(e); } });
  app.use(express.static(path.join(root, 'dist'))); app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  app.use((error, _req, res, _next) => { console.error('[API]', error.message); res.status(400).json({ error: error.message }); });
  return app;
}
