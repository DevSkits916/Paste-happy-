import { spawn } from 'node:child_process';

export async function copyToSystemClipboard(text) {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
    child.stdin.end(text, 'utf8');
  });
}
