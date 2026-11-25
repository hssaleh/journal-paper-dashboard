import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { extractPapersFromPageText, stripSensitiveQueryParams } from './server/geminiExtractor.ts';
import {
  extractWithLocalSmartReader,
  extractWithOllama,
  extractWithPollinations,
} from './server/freeExtractor.ts';
import { getTestTrackerHtml } from './server/testTrackers.ts';
import { buildCrossBrowserExtensionZip } from './server/extensionBuilder.ts';

function htmlToReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  const hints: string[] = [];
  if (title) hints.push(`Page Title: ${title}`);

  const metaPatterns = [
    /<meta[^>]+name=["']citation_journal_title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_journal_title["']/i,
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  ];
  for (const re of metaPatterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) {
      hints.push(`Journal Banner: ${m[1].trim()}`);
      break;
    }
  }

  const imgAltMatches = html.matchAll(/<img[^>]+alt=["']([^"']{3,100})["'][^>]*>/gi);
  for (const m of imgAltMatches) {
    const alt = m[1].replace(/\s+/g, ' ').trim();
    if (
      alt &&
      !/^(logo|banner|icon|button|help|elsevier|springer|editorial manager|authorhub|arrow|chevron|caret)$/i.test(alt) &&
      !/\b(logo|non solus|brandmark|emblem|favicon|icon|arrow|chevron|caret|spinner|loading|avatar|badge|tooltip|illustration|graphic|placeholder|button|close|download)\b/i.test(alt)
    ) {
      hints.push(`Journal Banner: ${alt}`);
      break;
    }
  }

  // Remove scripts, styles, noscript, svg
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  // Keep leaf <td>/<th> cell contents on one line so <br>/<div> links in Editorial Manager Action columns
  // do not break table rows across lines.
  cleaned = cleaned.replace(
    /(<t[dh]\b[^>]*>)([\s\S]*?)(<\/t[dh]>)/gi,
    (_full, open: string, inner: string, close: string) => {
      if (/<table\b/i.test(inner)) return `${open}${inner}${close}`;
      const flattened = inner
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?(?:p|div|li|span|a)[^>]*>/gi, ' ')
        .replace(/[\r\n]+/g, ' ');
      return `${open}${flattened}${close}`;
    }
  );

  // Preserve table cell boundaries and line breaks for clean AI reading
  cleaned = cleaned
    .replace(/<\/(tr|p|div|li|h1|h2|h3|h4|h5|h6|br|section|article)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const lines = cleaned
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);

  return { title, text: [...hints, ...lines].join('\n') };
}

function encodeMimeEmail(to: string, subject: string, bodyText: string): string {
  const headers = [
    `To: ${to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    '',
    bodyText,
  ].join('\r\n');

  return Buffer.from(headers, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '4mb' }));

  // Health / AI diagnostic endpoint (never returns secret values)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: true,
      freeProvidersReady: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: 'Free Open AI (Pollinations) + Built-in Local Reader',
      serverTimeUtc: new Date().toISOString(),
    });
  });

  // Safe built-in test tracker endpoints for acceptance checklist verification
  app.get('/api/test-tracker/:scenario', async (req, res) => {
    const { scenario } = req.params;
    const result = getTestTrackerHtml(scenario);
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    res.status(result.status).type('text/html').send(result.html);
  });

  // Fetch public or sandbox tracker URL with strict timeout and zero credential persistence
  app.post('/api/fetch-page', async (req, res) => {
    const { url, timeoutMs = 12000 } = req.body as { url?: string; timeoutMs?: number };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing URL' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ ok: false, error: 'Only http and https web addresses are supported.' });
      }
    } catch {
      return res.status(400).json({ ok: false, error: 'That does not look like a valid web address.' });
    }

    // Resolve local test-tracker requests internally without extra external hop issues
    if (parsedUrl.pathname.startsWith('/api/test-tracker/')) {
      const scenario = parsedUrl.pathname.replace('/api/test-tracker/', '');
      const testRes = getTestTrackerHtml(scenario);
      const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 12000, 2000), 18000);
      if (testRes.delayMs && testRes.delayMs > boundedTimeout) {
        await new Promise((resolve) => setTimeout(resolve, boundedTimeout));
        return res.status(504).json({
          ok: false,
          code: 'TIMEOUT',
          error: 'Page took too long to respond. Saved data was left untouched.',
          technicalDetails: `Exceeded ${boundedTimeout}ms timeout on ${stripSensitiveQueryParams(url)}`,
        });
      }
      if (testRes.status === 404) {
        return res.status(404).json({
          ok: false,
          code: 'NOT_FOUND',
          error: 'Tracker page returned 404 Not Found.',
        });
      }
      const extracted = htmlToReadableText(testRes.html);
      return res.json({
        ok: true,
        title: extracted.title,
        text: extracted.text,
      });
    }

    const controller = new AbortController();
    const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 12000, 3000), 20000);
    const timer = setTimeout(() => controller.abort(), boundedTimeout);

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(timer);

      if (response.status === 401 || response.status === 403) {
        return res.status(200).json({
          ok: false,
          code: 'SIGN_IN_NEEDED',
          error: 'Sign-in needed. Open this page in your browser profile or connect the browser extension.',
          technicalDetails: `HTTP ${response.status} from ${parsedUrl.hostname}`,
        });
      }

      if (response.status === 404) {
        return res.status(200).json({
          ok: false,
          code: 'NOT_FOUND',
          error: 'Tracker page was not found (404).',
          technicalDetails: `HTTP 404 from ${parsedUrl.hostname}`,
        });
      }

      if (!response.ok) {
        return res.status(502).json({
          ok: false,
          code: 'FETCH_ERROR',
          error: `Tracker page returned status ${response.status}.`,
          technicalDetails: `HTTP ${response.status} from ${parsedUrl.hostname}`,
        });
      }

      const html = await response.text();
      const { title, text } = htmlToReadableText(html);

      return res.json({
        ok: true,
        title,
        text,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        return res.status(504).json({
          ok: false,
          code: 'TIMEOUT',
          error: 'Page took too long to load. Saved data was left untouched.',
          technicalDetails: `Request aborted after ${boundedTimeout}ms`,
        });
      }
      return res.status(502).json({
        ok: false,
        code: 'FETCH_ERROR',
        error: 'Could not reach this page directly from the server. Use the browser extension or paste page text for signed-in portals.',
        technicalDetails: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Server-side AI extraction endpoint (receives ONLY page text)
  app.post('/api/extract', async (req, res) => {
    const {
      pageText,
      sourceUrl,
      pageTitle,
      provider = 'auto_free',
    } = req.body as {
      pageText?: string;
      sourceUrl?: string;
      pageTitle?: string;
      provider?: string;
    };

    if (!pageText || typeof pageText !== 'string') {
      return res.status(400).json({
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: 'No page text was provided for extraction.',
      });
    }

    const url = sourceUrl || 'unknown';
    const localFallbackIfReady = () => {
      const localRes = extractWithLocalSmartReader(pageText, url, pageTitle);
      const localUsable =
        localRes.ok &&
        (localRes.pageState !== 'ok' ||
          (localRes.papers.length > 0 &&
            localRes.papers.every(
              (p) => Boolean(p.currentStatus) && (Boolean(p.title) || Boolean(p.manuscriptNumber))
            )));
      return localUsable ? localRes : null;
    };

    if (provider === 'gemini') {
      const gemRes = await extractPapersFromPageText(pageText, url, pageTitle);
      if (gemRes.ok) return res.json(gemRes);
      const localRes = localFallbackIfReady();
      if (localRes) return res.json(localRes);
      return res.json(gemRes);
    }

    if (provider === 'local_reader') {
      return res.json(extractWithLocalSmartReader(pageText, url, pageTitle));
    }

    if (provider === 'ollama') {
      const ollamaRes = await extractWithOllama(pageText, url, pageTitle);
      if (ollamaRes.ok) return res.json(ollamaRes);
      const localRes = localFallbackIfReady();
      if (localRes) return res.json(localRes);
      return res.json(ollamaRes);
    }

    if (provider === 'pollinations') {
      const polRes = await extractWithPollinations(pageText, url, pageTitle);
      if (polRes.ok) return res.json(polRes);
      const localRes = localFallbackIfReady();
      if (localRes) return res.json(localRes);
      return res.json(polRes);
    }

    // Default 'auto_free': Built-in Local Smart Reader first (instant, zero rate limits)
    // with Free Open AI cloud fallback for unfamiliar page layouts.
    const localRes = extractWithLocalSmartReader(pageText, url, pageTitle);
    const localHighConfidence =
      localRes.ok &&
      (localRes.pageState !== 'ok' ||
        (localRes.papers.length > 0 &&
          localRes.papers.every(
            (p) => Boolean(p.currentStatus) && (Boolean(p.title) || Boolean(p.manuscriptNumber))
          )));

    if (localHighConfidence) {
      return res.json(localRes);
    }

    const freeRes = await extractWithPollinations(pageText, url, pageTitle);
    if (freeRes.ok) {
      return res.json(freeRes);
    }

    if (localRes.ok) {
      return res.json(localRes);
    }

    return res.json({
      ...freeRes,
      technicalDetails: [freeRes.technicalDetails, localRes.error].filter(Boolean).join(' | '),
    });
  });

  // Gmail API send proxy (requires client-side Google OAuth Bearer token)
  app.post('/api/gmail/send', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'Sign in with Google first to send email alerts.',
      });
    }

    const { to, subject, bodyText, simulateFailure } = req.body as {
      to?: string;
      subject?: string;
      bodyText?: string;
      simulateFailure?: boolean;
    };

    if (simulateFailure) {
      return res.status(503).json({
        ok: false,
        error: 'Simulated email delivery failure for testing retry queue.',
      });
    }

    if (!to || !subject || !bodyText) {
      return res.status(400).json({ ok: false, error: 'Missing email recipient, subject, or body.' });
    }

    try {
      const raw = encodeMimeEmail(to, subject, bodyText);
      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });

      const data = (await gmailRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!gmailRes.ok) {
        return res.status(gmailRes.status).json({
          ok: false,
          error: data?.error?.message || `Gmail send failed with HTTP ${gmailRes.status}`,
        });
      }

      return res.json({ ok: true, messageId: data.id });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unexpected Gmail send error',
      });
    }
  });

  // Downloadable Cross-Browser Extension ZIP (Edge, Chrome, Firefox MV3)
  app.get('/api/extension/download', async (req, res) => {
    try {
      const origin =
        process.env.APP_URL ||
        `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
      const zipBuffer = await buildCrossBrowserExtensionZip(origin);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="journal-paper-dashboard-extension.zip"'
      );
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to package browser extension',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Journal Paper Dashboard running on http://localhost:${PORT}`);
  });
}

startServer();
