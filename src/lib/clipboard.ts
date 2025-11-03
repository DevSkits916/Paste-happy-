export type ClipboardPermissionState = PermissionState | 'unsupported';

export interface CopyResult {
  success: boolean;
  method: 'navigator' | 'fallback';
  error?: unknown;
}

export async function probeClipboardPermission(): Promise<ClipboardPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
    return status.state;
  } catch (error) {
    console.warn('clipboard permission probe failed', error);
    return 'unsupported';
  }
}

export async function copyText(text: string): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'navigator' };
    } catch (err) {
      console.warn('Clipboard write failed, falling back', err);
    }
  }

  try {
    fallbackCopy(text);
    return { success: true, method: 'fallback' };
  } catch (error) {
    return { success: false, method: 'fallback', error };
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.top = '0';
  textarea.style.left = '0';

  document.body.appendChild(textarea);
  const selection = document.getSelection();
  const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const successful = document.execCommand('copy');
  if (!successful) {
    throw new Error('document.execCommand failed');
  }

  if (originalRange && selection) {
    selection.removeAllRanges();
    selection.addRange(originalRange);
  }
  document.body.removeChild(textarea);
}
