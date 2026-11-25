import type { ExtractionResponse } from '../types';

export interface PageCaptureResult {
  ok: boolean;
  text?: string;
  title?: string;
  url?: string;
  code?: 'TIMEOUT' | 'SIGN_IN_NEEDED' | 'NOT_FOUND' | 'FETCH_ERROR' | 'NO_OPEN_TAB';
  error?: string;
  technicalDetails?: string;
  via?: 'extension' | 'server';
}

let extensionDetected = false;
const listeners = new Set<(ready: boolean) => void>();

export function subscribeExtensionStatus(cb: (ready: boolean) => void): () => void {
  listeners.add(cb);
  cb(extensionDetected);
  return () => listeners.delete(cb);
}

export function isExtensionConnected(): boolean {
  return extensionDetected;
}

export function initExtensionBridge(
  onPushedTabCapture?: (payload: { text: string; title: string; url: string }) => void
): () => void {
  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'JPD_EXTENSION_READY') {
      extensionDetected = true;
      listeners.forEach((cb) => cb(true));
    }

    if (data.type === 'JPD_PUSH_TAB_CAPTURE' && data.payload && onPushedTabCapture) {
      onPushedTabCapture(data.payload);
    }
  };

  window.addEventListener('message', handleMessage);
  window.postMessage({ type: 'JPD_CHECK_EXTENSION' }, window.location.origin);

  return () => window.removeEventListener('message', handleMessage);
}

function readViaExtension(url: string, timeoutMs = 26000): Promise<PageCaptureResult> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      resolve({
        ok: false,
        code: 'TIMEOUT',
        error: 'Open portal tab took too long to refresh and respond.',
        technicalDetails: `Extension reload+read timed out after ${timeoutMs}ms`,
        via: 'extension',
      });
    }, timeoutMs);

    function onMsg(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'JPD_EXT_READ_URL_RESULT' && data.requestId === requestId) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        const res = data.result;
        if (res?.ok && res.text) {
          resolve({
            ok: true,
            text: res.text,
            title: res.title,
            url: res.url || url,
            via: 'extension',
          });
        } else if (res?.noOpenTab) {
          resolve({
            ok: false,
            code: 'NO_OPEN_TAB',
            error:
              res?.error ||
              'Portal tab is not open in your browser. Open it first so it can be refreshed before reading (new tabs are never opened).',
            via: 'extension',
          });
        } else {
          resolve({
            ok: false,
            code: 'FETCH_ERROR',
            error: res?.error || 'Could not read tab via browser extension.',
            via: 'extension',
          });
        }
      }
    }

    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'JPD_EXT_READ_URL', requestId, url }, window.location.origin);
  });
}

export async function captureTrackerPageText(
  rawUrl: string,
  timeoutMs = 12000
): Promise<PageCaptureResult> {
  // Always use the installed browser extension for external tracker portals when available
  // so it refreshes the already-open portal tab first without ever opening a new tab.
  const isLocalTest = rawUrl.includes('/api/test-tracker/');
  if (extensionDetected && !isLocalTest) {
    const extResult = await readViaExtension(rawUrl, Math.max(timeoutMs + 14000, 26000));
    if (extResult.ok) return extResult;
    if (extResult.code === 'TIMEOUT' || extResult.code === 'NO_OPEN_TAB') {
      return extResult;
    }
  }

  try {
    const res = await fetch('/api/fetch-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, timeoutMs }),
    });
    const data = (await res.json()) as PageCaptureResult;
    return { ...data, via: 'server' };
  } catch (err) {
    return {
      ok: false,
      code: 'FETCH_ERROR',
      error: 'Network error while reaching tracker page.',
      technicalDetails: err instanceof Error ? err.message : String(err),
      via: 'server',
    };
  }
}

export async function extractPapersFromCapturedText(params: {
  pageText: string;
  sourceUrl: string;
  pageTitle?: string;
  provider?: string;
}): Promise<ExtractionResponse> {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await res.json()) as ExtractionResponse;
}
