import { spawn } from 'node:child_process';

export async function copyToSystemClipboard(text) {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timeout); resolve(result); } };
    const timeout = setTimeout(() => { child.kill(); finish(false); }, 1500);
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
    child.stdin.end(text, 'utf8');
  });
}
