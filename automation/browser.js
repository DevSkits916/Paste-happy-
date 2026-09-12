import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

export class BrowserManager {
  constructor({ profilePath, headless, executablePath }) { this.profilePath = profilePath; this.headless = headless; this.executablePath = executablePath; this.context = null; }
  async exists() { try { return (await readdir(this.profilePath)).length > 0; } catch { return false; } }
  async open() {
    if (this.context) return this.context;
    await mkdir(this.profilePath, { recursive: true });
    const bundledBrowser = chromium.executablePath();
    const executablePath = this.executablePath || (existsSync(bundledBrowser) ? undefined : this.systemChrome());
    this.context = await chromium.launchPersistentContext(this.profilePath, { headless: this.headless, viewport: null, args: ['--start-maximized'], ...(executablePath ? { executablePath } : {}) });
    this.context.once('close', () => { this.context = null; }); return this.context;
  }
  systemChrome() {
    const candidates = process.platform === 'win32'
      ? [
          process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [];
    return candidates.find((candidate) => candidate && existsSync(candidate));
  }
  async login() { const context = await this.open(); const page = context.pages()[0] || await context.newPage(); await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }); return { opened: true }; }
  async page() { const context = await this.open(); return context.pages()[0] || context.newPage(); }
  async close() { const context = this.context; this.context = null; await context?.close().catch(() => {}); }
}
