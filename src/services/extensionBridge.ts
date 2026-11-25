import type { ExtractionResponse } from '../types';
import {
  extractWithLocalSmartReader,
  validateExtractedResult,
} from '../utils/localSmartReader';

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

export interface CaptureHints {
  manuscriptNumber?: string | null;
  title?: string | null;
}

function readViaExtension(
  url: string,
  timeoutMs = 35000,
  hints?: CaptureHints
): Promise<PageCaptureResult> {
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
    window.postMessage(
      { type: 'JPD_EXT_READ_URL', requestId, url, hints },
      window.location.origin
    );
  });
}

async function pingExtension(timeoutMs = 350): Promise<boolean> {
  if (extensionDetected) return true;
  if (typeof window === 'undefined') return false;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onReady);
      resolve(extensionDetected);
    }, timeoutMs);

    function onReady(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'JPD_EXTENSION_READY') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onReady);
        extensionDetected = true;
        listeners.forEach((cb) => cb(true));
        resolve(true);
      }
    }

    window.addEventListener('message', onReady);
    window.postMessage({ type: 'JPD_CHECK_EXTENSION' }, window.location.origin);
  });
}

export async function captureTrackerPageText(
  rawUrl: string,
  timeoutMs = 12000,
  hints?: CaptureHints
): Promise<PageCaptureResult> {
  // Always use the installed browser extension for external tracker portals when available
  // so it refreshes the already-open portal tab first without ever opening a new tab.
  const isLocalTest = rawUrl.includes('/api/test-tracker/');
  const extReady = !isLocalTest ? await pingExtension(350) : false;

  if (extReady && !isLocalTest) {
    const extResult = await readViaExtension(
      rawUrl,
      Math.max(timeoutMs + 23000, 35000),
      hints
    );
    if (extResult.ok) return extResult;
    if (extResult.code === 'TIMEOUT' || extResult.code === 'NO_OPEN_TAB') {
      return extResult;
    }
    if (
      extResult.error &&
      /extension was reloaded|extension context invalidated/i.test(extResult.error)
    ) {
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
    if (!data.ok && data.code === 'SIGN_IN_NEEDED' && !extReady && !isLocalTest) {
      return {
        ...data,
        via: 'server',
        technicalDetails: [
          data.technicalDetails,
          'Companion Extension was not connected on this dashboard tab (checked before fallback).',
        ]
          .filter(Boolean)
          .join(' | '),
      };
    }
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

async function tryBrowserLocalOllama(params: {
  pageText: string;
  sourceUrl: string;
  pageTitle?: string;
}): Promise<ExtractionResponse | null> {
  const cleaned = (params.pageText || '').trim();
  if (cleaned.length < 15) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const safeUrl = params.sourceUrl.split('?')[0] || 'unknown';

  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content:
              'Extract academic manuscript status JSON: {"pageState":"ok"|"sign_in_needed"|"not_found"|"empty_or_unreadable","papers":[{"journalName":string|null,"title":string|null,"manuscriptNumber":string|null,"revision":string|null,"submissionDate":"YYYY-MM-DD"|null,"currentStatus":string|null,"statusDate":"YYYY-MM-DD"|null}]}. Use exact status text from the page.',
          },
          {
            role: 'user',
            content: `Source: ${safeUrl}\nPage title: ${params.pageTitle || 'Unknown'}\n\n${cleaned.slice(0, 18000)}`,
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as { message?: { content?: string } };
    const raw = (data?.message?.content || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    const sliced =
      firstBrace !== -1 && lastBrace > firstBrace
        ? candidate.slice(firstBrace, lastBrace + 1)
        : candidate;
    const parsed = JSON.parse(sliced) as { pageState?: string; papers?: Record<string, unknown>[] };
    const validated = validateExtractedResult(parsed, cleaned, {
      sourceUrl: params.sourceUrl,
      pageTitle: params.pageTitle,
    });
    return validated.ok ? validated : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function extractPapersFromCapturedText(params: {
  pageText: string;
  sourceUrl: string;
  pageTitle?: string;
  provider?: string;
}): Promise<ExtractionResponse> {
  // 1. Built-in Local Reader (Offline): runs 100% locally in the browser with zero network dependency
  if (params.provider === 'local_reader') {
    return extractWithLocalSmartReader(
      params.pageText,
      params.sourceUrl,
      params.pageTitle
    );
  }

  // 2. Local Ollama: try direct localhost Ollama from the user's browser first (works even on Render/cloud hosting)
  if (params.provider === 'ollama') {
    const directOllama = await tryBrowserLocalOllama(params);
    if (directOllama) return directOllama;
  }

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as ExtractionResponse;
      if (parsed.ok) return parsed;
      // Last-chance local smart reader fallback if server AI returned an error on recognizable text
      const localCheck = extractWithLocalSmartReader(
        params.pageText,
        params.sourceUrl,
        params.pageTitle
      );
      if (localCheck.ok) return localCheck;
      return parsed;
    } catch {
      const localCheck = extractWithLocalSmartReader(
        params.pageText,
        params.sourceUrl,
        params.pageTitle
      );
      if (localCheck.ok) return localCheck;
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: `Extraction endpoint returned an unexpected response (HTTP ${res.status}).`,
        technicalDetails: raw.slice(0, 300),
      };
    }
  } catch (err) {
    // Offline or server unavailable: fall back seamlessly to browser-side Built-in Local Reader
    const localFallback = extractWithLocalSmartReader(
      params.pageText,
      params.sourceUrl,
      params.pageTitle
    );
    if (localFallback.ok) return localFallback;

    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Could not reach the page extraction service.',
      technicalDetails: err instanceof Error ? err.message : String(err),
    };
  }
}
