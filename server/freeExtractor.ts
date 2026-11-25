import type { ExtractedPaper, ExtractionResponse } from '../src/types.ts';
import {
  extractWithLocalSmartReader,
  KNOWN_STATUS_PHRASES,
  validateExtractedResult,
} from '../src/utils/localSmartReader.ts';
import { stripSensitiveQueryParams } from './geminiExtractor.ts';

export { extractWithLocalSmartReader, KNOWN_STATUS_PHRASES, validateExtractedResult };

let pollinationsCooldownUntil = 0;

export function getPollinationsCooldownRemainingMs(): number {
  return Math.max(0, pollinationsCooldownUntil - Date.now());
}

export function resetPollinationsCooldownForTests(): void {
  pollinationsCooldownUntil = 0;
}

function compactTextForLlm(cleanedText: string, maxChars: number): string {
  if (cleanedText.length <= maxChars) return cleanedText;
  const pageTextMarker = '--- PAGE TEXT ---';
  const idx = cleanedText.indexOf(pageTextMarker);
  if (idx === -1) return cleanedText.slice(0, maxChars);

  const structuredHead = cleanedText.slice(0, idx);
  const remainingBudget = Math.max(2000, maxChars - structuredHead.length);
  return `${structuredHead}${cleanedText.slice(idx, idx + remainingBudget)}`;
}

export function buildExtractionMessages(
  cleanedText: string,
  sourceUrl: string,
  pageTitle?: string,
  maxChars = 14000
) {
  const safeUrlHint = stripSensitiveQueryParams(sourceUrl);
  const boundedText = compactTextForLlm(cleanedText, maxChars);

  const systemPrompt = `You are a precision academic manuscript tracker parser.
Extract structured manuscript status records strictly from the supplied page text and return ONLY valid JSON.

CRITICAL RULES:
1. EVERY extracted value MUST come directly from the page text, page title, or journal banner/URL hint. NEVER invent missing fields. Use null if missing.
2. NEVER normalize or rewrite currentStatus. Copy the exact verbatim status wording from the page (e.g. "With Editor", "Under Review", "Minor Revision Required").
3. NEVER put a date (such as "23 Nov 2026", "Nov 15, 2026", or "2026-11-23") into currentStatus! Dates belong in submissionDate or statusDate. In Editorial Manager tables, "Status Date" is a date column and "Current Status" is the separate status text column.
4. For journalName: check table columns, "Submitted to ...", "Journal Banner:", Page title, and the Editorial Manager portal path if shown.
5. If the page is a login form, session timeout screen, or asks for username/password, return {"pageState":"sign_in_needed","papers":[]}.
6. If the page says manuscript/article not found or 404, return {"pageState":"not_found","papers":[]}.
7. Return ALL manuscripts shown on the page (1 for detail pages, N for list/table pages).
8. Convert unambiguous dates to YYYY-MM-DD. If a numeric date has an ambiguous day/month order (e.g. "04/05/2026" where both 04 and 05 are <= 12), provide best YYYY-MM-DD parse, set the corresponding *DateAmbiguous flag to true, and include that field name in uncertainFields.
9. Only set "decision" when the page explicitly writes a decision.

Required JSON schema:
{
  "pageState": "ok" | "sign_in_needed" | "not_found" | "empty_or_unreadable",
  "papers": [
    {
      "journalName": string | null,
      "title": string | null,
      "manuscriptNumber": string | null,
      "revision": string | null,
      "submissionType": string | null,
      "submissionDate": "YYYY-MM-DD" | null,
      "submissionDateAmbiguous": boolean,
      "currentStatus": string | null,
      "statusDate": "YYYY-MM-DD" | null,
      "statusDateAmbiguous": boolean,
      "editorOrTeam": string | null,
      "reviewCount": number | null,
      "decision": string | null,
      "uncertainFields": string[],
      "pageEventHistory": []
    }
  ]
}`;

  const userPrompt = `Source site/path (tokens stripped): ${safeUrlHint}
Page title: ${pageTitle || 'Unknown'}

--- PAGE TEXT START ---
${boundedText}
--- PAGE TEXT END ---`;

  return { systemPrompt, userPrompt };
}

export function parseJsonFromLlmOutput(
  rawText: string
): { pageState?: string; papers?: Partial<ExtractedPaper>[] } {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = jsonCandidate.indexOf('{');
  const lastBrace = jsonCandidate.lastIndexOf('}');
  const sliced =
    firstBrace !== -1 && lastBrace > firstBrace
      ? jsonCandidate.slice(firstBrace, lastBrace + 1)
      : jsonCandidate;
  return JSON.parse(sliced) as { pageState?: string; papers?: Partial<ExtractedPaper>[] };
}

/* -------------------------------------------------------------------------- */
/* 1. Pollinations Open AI (Free Cloud AI with Rate-Limit Guard)              */
/* -------------------------------------------------------------------------- */
export async function extractWithPollinations(
  pageText: string,
  sourceUrl: string,
  pageTitle?: string
): Promise<ExtractionResponse> {
  const cleanedText = (pageText || '').trim();
  if (!cleanedText || cleanedText.length < 15) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Page returned too little readable text to extract manuscript fields.',
      technicalDetails: `Text length: ${cleanedText.length}`,
    };
  }

  const remainingMs = getPollinationsCooldownRemainingMs();
  if (remainingMs > 0) {
    const secs = Math.ceil(remainingMs / 1000);
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: `Free Open AI cloud rate limit active (${secs}s cooldown). Built-in Local Reader handles supported portals automatically, or retry in ${secs}s. Saved data was left untouched.`,
      technicalDetails: `Cooldown active for ${secs}s after prior 402/429/503 response`,
    };
  }

  const { systemPrompt, userPrompt } = buildExtractionMessages(
    cleanedText,
    sourceUrl,
    pageTitle,
    14000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);

  try {
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: 'openai',
        jsonMode: true,
        seed: 42,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status === 402 || res.status === 429 || res.status === 503) {
        const cooldownMs = res.status === 503 ? 16000 : 46000;
        pollinationsCooldownUntil = Date.now() + cooldownMs;
        return {
          ok: false,
          pageState: 'ai_error',
          papers: [],
          error:
            res.status === 503
              ? 'Free Open AI cloud is temporarily busy (HTTP 503). Built-in Local Reader handles supported portals automatically.'
              : 'Free Open AI cloud rate limit reached (1 request per 45s). Wait ~45s and retry, or use Built-in Local Reader. Saved data was left untouched.',
          technicalDetails: `HTTP ${res.status}: ${errBody.slice(0, 400)}`,
        };
      }
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: `Free Open AI endpoint returned HTTP ${res.status}. Saved data was left untouched.`,
        technicalDetails: errBody.slice(0, 500),
      };
    }

    const rawText = await res.text();
    const parsed = parseJsonFromLlmOutput(rawText);
    return validateExtractedResult(parsed, cleanedText, { sourceUrl, pageTitle });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Free Open AI reader could not complete the request. Saved data was left untouched.',
      technicalDetails: msg,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Local Ollama (Runs on User PC, 100% Free & Private, Zero Cloud Limits)  */
/* -------------------------------------------------------------------------- */
export async function extractWithOllama(
  pageText: string,
  sourceUrl: string,
  pageTitle?: string
): Promise<ExtractionResponse> {
  const cleanedText = (pageText || '').trim();
  if (!cleanedText || cleanedText.length < 15) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Page returned too little readable text to extract manuscript fields.',
    };
  }

  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
  const { systemPrompt, userPrompt } = buildExtractionMessages(
    cleanedText,
    sourceUrl,
    pageTitle,
    24000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: `Local Ollama returned HTTP ${res.status}. Saved data was left untouched.`,
      };
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const parsed = parseJsonFromLlmOutput(data?.message?.content || '');
    return validateExtractedResult(parsed, cleanedText, { sourceUrl, pageTitle });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: `Could not connect to Local Ollama at ${ollamaBase}. Start Ollama on your PC or switch AI provider in Settings.`,
      technicalDetails: err instanceof Error ? err.message : String(err),
    };
  }
}
