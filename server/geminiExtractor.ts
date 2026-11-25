import { GoogleGenAI, Type } from '@google/genai';
import type { ExtractedPaper, ExtractionResponse } from '../src/types.ts';
import {
  isBadOrGenericJournalName,
  isLikelyDateString,
  resolveJournalNameFromHints,
} from '../src/utils/journalLookup.ts';

function isValidIsoDate(value: string | null | undefined): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function coerceGeminiDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^(?:null|none|n\/a|na|unknown|not\s+shown|-+)$/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (m && isValidIsoDate(m[1])) return m[1];
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const iso = new Date(parsed).toISOString().slice(0, 10);
    if (isValidIsoDate(iso)) return iso;
  }
  return null;
}

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function stripSensitiveQueryParams(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0] || 'unknown-url';
  }
}

export async function extractPapersFromPageText(
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'AI extraction is unavailable because the Gemini API key is not configured.',
      technicalDetails: 'Missing process.env.GEMINI_API_KEY on server.',
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 20000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const safeUrlHint = stripSensitiveQueryParams(sourceUrl);
  // Truncate excessively huge pages to stay well within token bounds while keeping full list data
  const boundedText = cleanedText.slice(0, 60000);

  const systemInstruction = `You are a precision academic manuscript tracker parser.
Your job is to extract structured manuscript status records strictly from the supplied page text.

CRITICAL RULES:
1. EVERY extracted value MUST come directly from the page text, page title, or journal banner/URL hint. NEVER invent missing fields. If a field is not present, return null.
2. NEVER normalize or rewrite currentStatus. Copy the exact verbatim status wording as written on the page (e.g. "With Editor", "Under Review", "Minor Revision Required", "Submissions Being Processed for Author").
3. NEVER put a date (such as "23 Nov 2026", "Nov 15, 2026", or "2026-11-23") into currentStatus. Dates belong in submissionDate or statusDate.
4. If the page text is a login form, session timeout screen, CAPTCHA, or asks the user to sign in / enter username & password, set pageState to "sign_in_needed" and return an empty papers array.
5. If the page says the manuscript or article was not found / 404, set pageState to "not_found".
6. A page may list ONE manuscript (detail view) or MULTIPLE manuscripts (e.g., Editorial Manager author table / list / paginated view). Return ALL manuscripts shown on the page.
7. Dates: Convert unambiguous dates to YYYY-MM-DD. If a numeric date has an ambiguous day/month order (such as "04/05/2026" where both 04 and 05 are <= 12 and no unambiguous month name or ISO format clarifies it), still provide your best YYYY-MM-DD parse AND set the corresponding *DateAmbiguous boolean to true, AND add the field name to uncertainFields.
8. If you are unsure about any field value, include that field name (e.g., "statusDate", "submissionDate", "currentStatus", "journalName", "manuscriptNumber") in uncertainFields.
9. Do NOT treat a missing field or disappearance as Accepted or Rejected. Only set "decision" when the page explicitly writes a decision.`;

  const prompt = `Source site/path (tokens stripped): ${safeUrlHint}
Page title: ${pageTitle || 'Unknown'}

--- PAGE TEXT START ---
${boundedText}
--- PAGE TEXT END ---`;

  const attemptErrors: string[] = [];
  try {
    let response;
    const attempts: Array<{ model: string; useSchema: boolean }> = [
      { model: 'gemini-2.5-flash', useSchema: true },
      { model: 'gemini-2.5-flash-lite', useSchema: true },
      { model: 'gemini-3.1-flash-lite', useSchema: true },
      { model: 'gemini-2.5-flash', useSchema: false },
    ];
    for (let i = 0; i < attempts.length; i++) {
      const { model: modelName, useSchema } = attempts[i];
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: useSchema
            ? prompt
            : `${prompt}\n\nReturn ONLY a JSON object with shape: {"pageState":"ok"|"sign_in_needed"|"not_found"|"empty_or_unreadable","papers":[{"journalName":string|null,"title":string|null,"manuscriptNumber":string|null,"revision":string|null,"submissionType":string|null,"submissionDate":string|null,"submissionDateAmbiguous":boolean,"currentStatus":string|null,"statusDate":string|null,"statusDateAmbiguous":boolean,"editorOrTeam":string|null,"reviewCount":number|null,"decision":string|null,"uncertainFields":string[],"pageEventHistory":[]}]}`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            ...(useSchema
              ? {
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      pageState: {
                        type: Type.STRING,
                        description:
                          'One of: ok, sign_in_needed, not_found, empty_or_unreadable',
                      },
                      papers: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            journalName: { type: Type.STRING, nullable: true },
                            title: { type: Type.STRING, nullable: true },
                            manuscriptNumber: { type: Type.STRING, nullable: true },
                            revision: { type: Type.STRING, nullable: true },
                            submissionType: { type: Type.STRING, nullable: true },
                            submissionDate: {
                              type: Type.STRING,
                              nullable: true,
                              description: 'YYYY-MM-DD or null',
                            },
                            submissionDateAmbiguous: { type: Type.BOOLEAN },
                            currentStatus: {
                              type: Type.STRING,
                              nullable: true,
                              description: 'Exact verbatim status string appearing on the page',
                            },
                            statusDate: {
                              type: Type.STRING,
                              nullable: true,
                              description: 'YYYY-MM-DD or null',
                            },
                            statusDateAmbiguous: { type: Type.BOOLEAN },
                            editorOrTeam: { type: Type.STRING, nullable: true },
                            reviewCount: { type: Type.INTEGER, nullable: true },
                            decision: { type: Type.STRING, nullable: true },
                            uncertainFields: {
                              type: Type.ARRAY,
                              items: { type: Type.STRING },
                            },
                            pageEventHistory: {
                              type: Type.ARRAY,
                              items: {
                                type: Type.OBJECT,
                                properties: {
                                  date: { type: Type.STRING, nullable: true },
                                  status: { type: Type.STRING },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    required: ['pageState', 'papers'],
                  },
                }
              : {}),
          },
        });
        break;
      } catch (retryErr) {
        const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        attemptErrors.push(`${modelName}(schema=${useSchema}): ${msg}`);
        const isQuotaOrAuth =
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('403') ||
          msg.includes('PERMISSION_DENIED') ||
          msg.includes('API_KEY_INVALID');
        const isTransient =
          !isQuotaOrAuth &&
          (msg.includes('503') ||
            msg.includes('500') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('INTERNAL') ||
            msg.includes('DEADLINE_EXCEEDED') ||
            msg.includes('400') ||
            msg.includes('404') ||
            msg.includes('NOT_FOUND') ||
            msg.toLowerCase().includes('not found') ||
            msg.toLowerCase().includes('not supported') ||
            msg.toLowerCase().includes('timeout') ||
            msg.toLowerCase().includes('fetch failed'));
        if (!isTransient || i === attempts.length - 1) {
          throw new Error(attemptErrors.join(' | '));
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const rawJson = (response?.text || '').trim();
    if (!rawJson) {
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: 'AI returned an empty response. Saved data was left untouched.',
      };
    }

    const fenced = rawJson.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonCandidate = fenced ? fenced[1].trim() : rawJson;
    const firstBrace = jsonCandidate.indexOf('{');
    const lastBrace = jsonCandidate.lastIndexOf('}');
    const jsonSlice =
      firstBrace !== -1 && lastBrace > firstBrace
        ? jsonCandidate.slice(firstBrace, lastBrace + 1)
        : jsonCandidate;

    const parsed = JSON.parse(jsonSlice) as {
      pageState?: string;
      papers?: ExtractedPaper[];
    };

    if (parsed.pageState === 'sign_in_needed') {
      return {
        ok: true,
        pageState: 'sign_in_needed',
        papers: [],
      };
    }

    if (parsed.pageState === 'not_found') {
      return {
        ok: true,
        pageState: 'not_found',
        papers: [],
      };
    }

    if (parsed.pageState === 'empty_or_unreadable' || !Array.isArray(parsed.papers)) {
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: 'AI could not read structured manuscript records from this page.',
        technicalDetails: `pageState=${parsed.pageState}`,
      };
    }

    const normalizedPage = normalizeWhitespace(cleanedText);
    const normPageAlphaNum = normalizedPage.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');

    const validatedPapers: ExtractedPaper[] = [];
    for (const p of parsed.papers) {
      const uncertainSet = new Set<string>(
        Array.isArray(p.uncertainFields) ? p.uncertainFields : []
      );
      const safeSubDate = p.submissionDate ? coerceGeminiDate(p.submissionDate) : null;
      const safeStatusDate = p.statusDate ? coerceGeminiDate(p.statusDate) : null;
      if (p.submissionDate && !safeSubDate) uncertainSet.add('submissionDate');
      if (p.statusDate && !safeStatusDate) uncertainSet.add('statusDate');

      let safeStatus = p.currentStatus?.trim() || null;
      if (safeStatus) {
        if (isLikelyDateString(safeStatus)) {
          safeStatus = null;
          uncertainSet.add('currentStatus');
        } else {
          const normStatus = normalizeWhitespace(safeStatus);
          const normStatusAlphaNum = normStatus
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const inPage =
            normalizedPage.includes(normStatus) ||
            Boolean(normStatusAlphaNum && normPageAlphaNum.includes(normStatusAlphaNum));
          if (!inPage) {
            uncertainSet.add('currentStatus');
          }
        }
      }

      const msNum = p.manuscriptNumber?.trim() || null;
      const titleVal = p.title?.trim() || null;
      if (!titleVal && !msNum && !safeStatus) continue;

      const rawJournal = p.journalName?.trim() || '';
      const resolvedJournal = !isBadOrGenericJournalName(rawJournal)
        ? rawJournal
        : resolveJournalNameFromHints({
            pageText: cleanedText,
            pageTitle,
            sourceUrl,
            manuscriptNumber: msNum,
          });

      validatedPapers.push({
        journalName: resolvedJournal || null,
        title: titleVal,
        manuscriptNumber: msNum,
        revision: p.revision?.trim() || null,
        submissionType: p.submissionType?.trim() || null,
        submissionDate: safeSubDate,
        submissionDateAmbiguous: Boolean(p.submissionDateAmbiguous),
        currentStatus: safeStatus,
        statusDate: safeStatusDate,
        statusDateAmbiguous: Boolean(p.statusDateAmbiguous),
        editorOrTeam: p.editorOrTeam?.trim() || null,
        reviewCount: typeof p.reviewCount === 'number' ? p.reviewCount : null,
        decision: p.decision?.trim() || null,
        uncertainFields: Array.from(uncertainSet),
        pageEventHistory: Array.isArray(p.pageEventHistory) ? p.pageEventHistory : [],
      });
    }

    if (validatedPapers.length === 0) {
      return {
        ok: false,
        pageState: 'ai_error',
        papers: [],
        error: 'No manuscript records were found on this page.',
      };
    }

    return {
      ok: true,
      pageState: 'ok',
      papers: validatedPapers,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let friendlyError = 'AI extraction encountered an error; saved data was left untouched.';
    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      friendlyError =
        'Gemini API free-tier quota limit reached (20 requests/day). Select a billing-enabled API key in Settings > Secrets, or try again later. Saved data was left untouched.';
    } else if (message.includes('403') || message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')) {
      friendlyError =
        'Gemini API key permission error. Check your API key in Settings > Secrets. Saved data was left untouched.';
    } else if (message.includes('503') || message.includes('UNAVAILABLE')) {
      friendlyError =
        'The AI model is temporarily experiencing high demand. Please retry in a moment. Saved data was left untouched.';
    }

    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: friendlyError,
      technicalDetails: message,
    };
  }
}
