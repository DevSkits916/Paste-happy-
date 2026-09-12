import { mkdir, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

export class BrowserManager {
  constructor({ profilePath, headless }) { this.profilePath = profilePath; this.headless = headless; this.context = null; }
  async exists() { try { return (await readdir(this.profilePath)).length > 0; } catch { return false; } }
  async open() {
    if (this.context) return this.context;
    await mkdir(this.profilePath, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.profilePath, { headless: this.headless, viewport: null, args: ['--start-maximized'] });
    this.context.once('close', () => { this.context = null; }); return this.context;
  }
  async login() { const context = await this.open(); const page = context.pages()[0] || await context.newPage(); await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }); return { opened: true }; }
  async page() { const context = await this.open(); return context.pages()[0] || context.newPage(); }
  async close() { const context = this.context; this.context = null; await context?.close().catch(() => {}); }
}
