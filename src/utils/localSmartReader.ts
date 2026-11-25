import type { ExtractedPaper, ExtractionResponse } from '../types.ts';
import {
  isBadOrGenericJournalName,
  isLikelyDateString,
  resolveJournalNameFromHints,
  stripRevisionTagFromTitle,
} from './journalLookup.ts';

export function isValidIsoDate(value: string | null | undefined): boolean {
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

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseDateToken(raw: string): { iso: string | null; ambiguous: boolean } {
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    const candidate = `${yyyy}-${mm}-${dd}`;
    return isValidIsoDate(candidate)
      ? { iso: candidate, ambiguous: false }
      : { iso: null, ambiguous: false };
  }

  const slashMatch = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const yyyy = Number(slashMatch[3]);
    if (a <= 12 && b <= 12 && a !== b) {
      const candidate = `${yyyy}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
      return {
        iso: isValidIsoDate(candidate) ? candidate : null,
        ambiguous: true,
      };
    }
    const mm = a > 12 ? b : a;
    const dd = a > 12 ? a : b;
    const candidate = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return {
      iso: isValidIsoDate(candidate) ? candidate : null,
      ambiguous: false,
    };
  }

  const monthNames: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  };

  const named1 = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/);
  if (named1 && monthNames[named1[2].toLowerCase()]) {
    const mm = monthNames[named1[2].toLowerCase()];
    const dd = named1[1].padStart(2, '0');
    const candidate = `${named1[3]}-${mm}-${dd}`;
    return { iso: isValidIsoDate(candidate) ? candidate : null, ambiguous: false };
  }

  const named2 = trimmed.match(/([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (named2 && monthNames[named2[1].toLowerCase()]) {
    const mm = monthNames[named2[1].toLowerCase()];
    const dd = named2[2].padStart(2, '0');
    const candidate = `${named2[3]}-${mm}-${dd}`;
    return { iso: isValidIsoDate(candidate) ? candidate : null, ambiguous: false };
  }

  return { iso: null, ambiguous: false };
}

function coerceIsoDateValue(value: string | null | undefined): {
  iso: string | null;
  ambiguous: boolean;
  invalid: boolean;
} {
  if (!value) return { iso: null, ambiguous: false, invalid: false };
  const trimmed = value.trim();
  if (
    !trimmed ||
    /^(?:null|none|n\/a|na|unknown|not\s+shown|not\s+available|-+)$/i.test(trimmed)
  ) {
    return { iso: null, ambiguous: false, invalid: false };
  }
  const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (isoPrefix && isValidIsoDate(isoPrefix[1])) {
    return { iso: isoPrefix[1], ambiguous: false, invalid: false };
  }
  const parsed = parseDateToken(trimmed);
  if (parsed.iso) {
    return { iso: parsed.iso, ambiguous: parsed.ambiguous, invalid: false };
  }
  return { iso: null, ambiguous: false, invalid: true };
}

export const KNOWN_STATUS_PHRASES = [
  'Submissions Being Processed for Author',
  'Submissions Being Processed',
  'Revisions Being Processed for Author',
  'Revised Manuscript Submitted',
  'Under Editorial Assessment',
  'Awaiting Reviewer Selection',
  'Awaiting Reviewer Scores',
  'Awaiting AE Recommendation',
  'Awaiting EIC Decision',
  'Awaiting Editor Decision',
  'Awaiting Recommendation',
  'Required Reviews Completed',
  'Final Editorial Decision',
  'Submission Under Review',
  'Manuscript Under Review',
  'Manuscript Under Consideration',
  'Under Consideration',
  'Editorial Assessment',
  'Submitted to Journal',
  'Manuscript Submitted',
  'Manuscript Received',
  'Submission Received',
  'Technical Check',
  'Quality Check',
  'Initial Assessment',
  'With the Editor',
  'With Editor',
  'With Journal',
  'Editor Assigned',
  'Editor Invited',
  'Under Review',
  'Out for Review',
  'Review in Progress',
  'In Review',
  'Peer Review',
  'Editorial Review',
  'Reviewers Invited',
  'Reviewers Assigned',
  'Reviews Completed',
  'Reviews Complete',
  'Reviews Received',
  'Review Complete',
  'Awaiting Decision',
  'Decision in Process',
  'Decision Pending',
  'Ready for Editor Decision',
  'Ready for Decision',
  'Accept with Minor Revisions',
  'Accept with Major Revisions',
  'Minor Revisions Required',
  'Major Revisions Required',
  'Minor Revision Required',
  'Major Revision Required',
  'Revision Requested',
  'Revise and Resubmit',
  'Minor Revisions',
  'Major Revisions',
  'Minor Revision',
  'Major Revision',
  'Revision Submitted',
  'Author Revision',
  'Sent Back to Author',
  'Revise',
  'Conditional Acceptance',
  'Provisionally Accepted',
  'Accepted for Publication',
  'Ready for Production',
  'Preprint Posted',
  'Accepted',
  'Accept',
  'In Press',
  'In Production',
  'Published',
  'Transfer Pending',
  'Peer Review in Progress',
  'Sent to Editorial Office',
  'Review Invitations Accepted',
  'Ready for Review',
  'Transfer to Another Journal',
  'Published Online',
  'Rejected',
  'Declined',
  'Withdrawn',
  'Completed',
  'Complete',
];

export function validateExtractedResult(
  parsed: { pageState?: string; papers?: Partial<ExtractedPaper>[] },
  cleanedText: string,
  hints?: { sourceUrl?: string; pageTitle?: string }
): ExtractionResponse {
  if (parsed.pageState === 'sign_in_needed') {
    return { ok: true, pageState: 'sign_in_needed', papers: [] };
  }
  if (parsed.pageState === 'not_found') {
    return { ok: true, pageState: 'not_found', papers: [] };
  }
  const papersInput = Array.isArray(parsed.papers) ? parsed.papers : null;
  if (
    parsed.pageState === 'empty_or_unreadable' ||
    !papersInput ||
    papersInput.length === 0
  ) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Could not read structured manuscript records from this page.',
      technicalDetails: `pageState=${parsed.pageState}`,
    };
  }

  const normalizedPage = normalizeWhitespace(cleanedText);
  const normPageAlphaNum = normalizedPage
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
  const validatedPapers: ExtractedPaper[] = [];

  for (const p of papersInput) {
    const subCoerced = coerceIsoDateValue(p.submissionDate);
    const statusDateCoerced = coerceIsoDateValue(p.statusDate);
    const uncertainSet = new Set<string>(
      Array.isArray(p.uncertainFields) ? p.uncertainFields : []
    );

    if (subCoerced.invalid) uncertainSet.add('submissionDate');
    if (statusDateCoerced.invalid) uncertainSet.add('statusDate');

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
          const statusWords = normStatusAlphaNum.split(' ').filter((w) => w.length >= 3);
          const matchingLinePhrase = KNOWN_STATUS_PHRASES.find((phrase) => {
            const np = phrase.toLowerCase();
            if (!normalizedPage.includes(np)) return false;
            return statusWords.some((w) => np.includes(w));
          });
          if (matchingLinePhrase) {
            safeStatus = matchingLinePhrase;
          } else {
            uncertainSet.add('currentStatus');
          }
        }
      }
    }

    const msNum = p.manuscriptNumber?.trim() || null;
    const titleVal = p.title?.trim() || null;
    if (!titleVal && !msNum && !safeStatus) {
      continue;
    }

    const rawJournal = p.journalName?.trim() || '';
    const resolvedJournal = !isBadOrGenericJournalName(rawJournal)
      ? rawJournal
      : resolveJournalNameFromHints({
          pageText: cleanedText,
          pageTitle: hints?.pageTitle,
          sourceUrl: hints?.sourceUrl,
          manuscriptNumber: msNum,
        });

    validatedPapers.push({
      journalName: resolvedJournal || null,
      title: titleVal,
      manuscriptNumber: msNum,
      revision: p.revision?.trim() || null,
      submissionType: p.submissionType?.trim() || null,
      submissionDate: subCoerced.iso,
      submissionDateAmbiguous: Boolean(p.submissionDateAmbiguous) || subCoerced.ambiguous,
      currentStatus: safeStatus,
      statusDate: statusDateCoerced.iso,
      statusDateAmbiguous: Boolean(p.statusDateAmbiguous) || statusDateCoerced.ambiguous,
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

  return { ok: true, pageState: 'ok', papers: validatedPapers };
}

function isTableHeaderLine(line: string): { isHeader: boolean; sep: '|' | '\t' | null } {
  const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : null;
  if (!sep) return { isHeader: false, sep: null };
  const ll = line.toLowerCase();
  const hasEntity =
    ll.includes('manuscript') ||
    ll.includes('title') ||
    ll.includes('submission') ||
    ll.includes('article') ||
    ll.includes('paper');
  const hasMeta =
    ll.includes('status') ||
    ll.includes('stage') ||
    ll.includes('journal') ||
    ll.includes('submitted') ||
    ll.includes('decision') ||
    ll.includes('updated');
  return { isHeader: hasEntity && hasMeta, sep };
}

function splitManuscriptNumberAndRevision(msRaw: string | null): {
  manuscriptNumber: string | null;
  revision: string | null;
} {
  if (!msRaw) return { manuscriptNumber: null, revision: null };
  const trimmed = msRaw.trim();
  const revMatch =
    trimmed.match(/\b(R\d+)\b/i) || trimmed.match(/(R\d+)$/i);
  const revision = revMatch ? revMatch[1].toUpperCase() : null;
  const manuscriptNumber = trimmed.replace(/\s+\bR\d+\b/i, '').trim() || null;
  return { manuscriptNumber, revision };
}

function isActionBoilerplate(line: string): boolean {
  const lower = line.trim().toLowerCase();
  if (!lower) return true;
  return (
    lower === 'action' ||
    lower === 'action links' ||
    lower === 'view submission' ||
    lower === 'view attachments' ||
    lower === 'send e-mail' ||
    lower === 'send email' ||
    lower === 'track manuscript' ||
    lower === 'view decision letter' ||
    lower === 'view reviews and comments' ||
    lower === 'similar articles in medline' ||
    lower === 'author main menu' ||
    lower === 'submissions being processed' ||
    lower === 'submissions being processed for author' ||
    lower.startsWith('page:')
  );
}

const KNOWN_FIELD_LABEL_RE =
  /^(?:manuscript\s*(?:number|id)|ms\s*(?:number|#)|submission\s*(?:id|date|type|received)|article\s*(?:title|type)|paper\s*title|manuscript\s*(?:title|status)|(?:current|editorial|submission)\s*status(?:\s*date)?|initial\s*(?:date\s*submitted|submission)|date\s*(?:submitted|of\s*status)|last\s*(?:status\s*change\s*date|updated(?:\s*on)?|update|activity)|updated(?:\s*on)?|submitted(?:\s*on)?|received(?:\s*on)?|journal(?:\s*(?:name|title))?|handling\s*editor|editor|editorial\s*(?:team|decision)|decision|reviews?\s*completed|reference|title|status)\s*[:\-]?\s*$/i;

export const ACADEMIC_MS_REGEX =
  /\b([A-Z]{2,12}-(?:[A-Z]-)?\d{2,4}-\d{2,7}(?:[\s._-]?R\d+)?|[A-Z]{2,10}-\d{2,4}-\d{2,7})\b/;

function matchStatusInLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || isLikelyDateString(trimmed) || isActionBoilerplate(trimmed)) return null;
  const lower = trimmed.toLowerCase();

  // 1. Exact phrase match
  const exact = KNOWN_STATUS_PHRASES.find((p) => lower === p.toLowerCase());
  if (exact) return trimmed;

  // 2. Skip header/banner boilerplate when doing substring matching
  if (
    /^(?:track your submission|submissions being processed|revisions being processed|author main menu|editorial manager|elsevier|research square)/i.test(
      trimmed
    )
  ) {
    return null;
  }

  // 3. Longest known status phrase appearing verbatim inside the line
  const sortedByLen = [...KNOWN_STATUS_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of sortedByLen) {
    if (phrase.length < 7) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${escaped})\\b`, 'i');
    const m = trimmed.match(re);
    if (m && m[1]) {
      return m[1];
    }
  }
  return null;
}

function parseSinglePaperKeyValueSection(
  lines: string[],
  cleanedText: string,
  sourceUrl: string,
  pageTitle?: string
): {
  paper: ExtractedPaper;
  hasTrackingSignals: boolean;
} {
  const findField = (prefixes: string[]): string | null => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const prefix of prefixes) {
        const re = new RegExp(`^${prefix}\\s*[:\\-]\\s*(.+)$`, 'i');
        const m = line.match(re);
        if (m && m[1]) {
          const val = m[1].trim();
          if (!KNOWN_FIELD_LABEL_RE.test(val)) return val;
        }

        const spaceRe = new RegExp(`^${prefix}\\s+(.+)$`, 'i');
        const exactLabelRe = new RegExp(`^${prefix}\\s*[:\\-]?$`, 'i');
        if (exactLabelRe.test(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (
            nextLine &&
            !KNOWN_FIELD_LABEL_RE.test(nextLine) &&
            !isActionBoilerplate(nextLine)
          ) {
            return nextLine;
          }
        }
        if (
          (prefix.toLowerCase().startsWith('submitted') ||
            prefix.toLowerCase().startsWith('received') ||
            prefix.toLowerCase().startsWith('last update') ||
            prefix.toLowerCase().startsWith('updated') ||
            prefix.toLowerCase().startsWith('last activity')) &&
          spaceRe.test(line)
        ) {
          const sm = line.match(spaceRe);
          if (
            sm &&
            sm[1] &&
            /\d/.test(sm[1]) &&
            !KNOWN_FIELD_LABEL_RE.test(sm[1].trim())
          ) {
            return sm[1].trim();
          }
        }
      }
    }
    return null;
  };

  let msRaw = findField([
    'Manuscript Number',
    'Manuscript ID',
    'MS Number',
    'Submission ID',
    'Reference',
  ]);
  if (!msRaw) {
    const msAnywhere = cleanedText.match(ACADEMIC_MS_REGEX);
    if (msAnywhere) msRaw = msAnywhere[1];
  }
  let { manuscriptNumber, revision } = splitManuscriptNumberAndRevision(msRaw);

  let journalName = findField(['Journal', 'Journal Name', 'Journal Title']);
  if (isBadOrGenericJournalName(journalName)) {
    journalName = resolveJournalNameFromHints({
      pageText: cleanedText,
      pageTitle,
      sourceUrl,
      manuscriptNumber,
    });
  }

  const ignoredHeadingRe =
    /^(page title:|journal banner:|heading 1:|heading 2:|submitted to |submitted on |published in |under consideration at |track your submission|track your accepted|details of your submission|submission overview|submission details|peer review|review timeline|timeline|recent activity|activity log|manuscript details|article details|need help|sign out|log out|privacy|cookie|terms|copyright|elsevier|authorhub|research square|editorial manager|corresponding author|review invitations|reviews completed|your submission|manuscript number|reference|last update|loading|---)/i;

  let title = findField([
    'Article Title',
    'Paper Title',
    'Manuscript Title',
    'Title',
    'Heading 1',
    'Heading 2',
  ]);
  if (title && ignoredHeadingRe.test(title)) {
    title = null;
  }
  const titleFoundExplicitly = Boolean(title);
  if (!title) {
    for (const line of lines.slice(0, 90)) {
      if (ignoredHeadingRe.test(line)) continue;
      if (KNOWN_FIELD_LABEL_RE.test(line)) continue;
      if (line.includes('|') || line.includes('\t')) continue;
      if (line.startsWith('http://') || line.startsWith('https://')) continue;
      if (isLikelyDateString(line) || isActionBoilerplate(line)) continue;
      if (ACADEMIC_MS_REGEX.test(line) && line.length < 35) continue;
      if (KNOWN_STATUS_PHRASES.some((p) => line.toLowerCase() === p.toLowerCase())) continue;
      if (line.includes(':') && line.split(':')[0].length < 28) continue;
      const wordCount = line.split(/\s+/).length;
      if (wordCount >= 3 && line.length >= 15 && line.length <= 280) {
        title = line;
        break;
      }
    }
  }

  if (title && !revision) {
    const revBracket = title.match(/\[\s*(\d+)(?:st|nd|rd|th)?\s+revision\s*\]/i);
    if (revBracket) {
      revision = `R${revBracket[1]}`;
    }
  }
  if (title) {
    const cleanTitle = stripRevisionTagFromTitle(title);
    if (cleanTitle.length >= 8) {
      title = cleanTitle;
    }
  }

  let currentStatus = findField([
    'Current Status',
    'Editorial Status',
    'Manuscript Status',
    'Submission Status',
    'Status',
  ]);
  if (currentStatus && isLikelyDateString(currentStatus)) {
    currentStatus = null;
  }
  if (!currentStatus) {
    for (const line of lines) {
      const matched = matchStatusInLine(line);
      if (matched) {
        currentStatus = matched;
        break;
      }
    }
  }

  let subRaw = findField([
    'Submission Date',
    'Initial Date Submitted',
    'Date Submitted',
    'Submission Received',
    'Initial Submission',
    'Submitted on',
    'Received on',
    'Received',
    'Submitted',
  ]);
  if (!subRaw) {
    const inlineSub = cleanedText.match(
      /(?:Submitted|Submission received|Initial submission|Received)(?:\s+on)?\s*[:\-]?\s*([A-Za-z0-9,.\-\/\s]{6,25}\d{4})/i
    );
    if (inlineSub?.[1]) subRaw = inlineSub[1];
  }

  let statusDateRaw = findField([
    'Last Status Change Date',
    'Status Date',
    'Date of Status',
    'Current Status Date',
    'Last updated on',
    'Last updated',
    'Last update',
    'Updated on',
    'Updated',
    'Last activity',
    'Activity date',
    'Most recent activity',
  ]);
  if (!statusDateRaw) {
    const inlineUpdate = cleanedText.match(
      /(?:Last updated|Last update|Status updated|Updated on|Updated|Last activity)\s*[:\-]?\s*([A-Za-z0-9,.\-\/\s]{6,25}\d{4})/i
    );
    if (inlineUpdate?.[1]) statusDateRaw = inlineUpdate[1];
  }

  const editorOrTeam = findField(['Handling Editor', 'Editor', 'Editorial Team']);
  const reviewsRaw = findField([
    'Reviews Completed',
    'Reviews completed',
    'Number of Reviews',
  ]);
  const decision = findField(['Decision', 'Editorial Decision']);
  const submissionType = findField(['Submission Type', 'Article Type']);

  const subParsed = subRaw ? parseDateToken(subRaw) : { iso: null, ambiguous: false };
  const stParsed = statusDateRaw
    ? parseDateToken(statusDateRaw)
    : { iso: null, ambiguous: false };
  const uncertainFields: string[] = [];
  if (subParsed.ambiguous) uncertainFields.push('submissionDate');
  if (stParsed.ambiguous) uncertainFields.push('statusDate');

  const hasTrackingSignals = Boolean(
    currentStatus ||
      manuscriptNumber ||
      (title && (titleFoundExplicitly || subParsed.iso || stParsed.iso))
  );

  return {
    hasTrackingSignals,
    paper: {
      journalName,
      title,
      manuscriptNumber,
      revision,
      submissionType,
      submissionDate: subParsed.iso,
      submissionDateAmbiguous: subParsed.ambiguous,
      currentStatus,
      statusDate: stParsed.iso,
      statusDateAmbiguous: stParsed.ambiguous,
      editorOrTeam,
      reviewCount: reviewsRaw && /^\d+$/.test(reviewsRaw) ? Number(reviewsRaw) : null,
      decision,
      uncertainFields,
      pageEventHistory: [],
    },
  };
}

export function extractWithLocalSmartReader(
  pageText: string,
  sourceUrl: string,
  pageTitle?: string
): ExtractionResponse {
  const cleanedText = (pageText || '').trim();
  if (!cleanedText || cleanedText.length < 15) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error: 'Page returned too little readable text.',
    };
  }

  const lower = cleanedText.toLowerCase();
  const lines = cleanedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const hasAnyTableHeader = lines.some((l) => isTableHeaderLine(l).isHeader);
  const hasManuscriptNumber = ACADEMIC_MS_REGEX.test(cleanedText);

  const hasExplicitAuthPrompt =
    (lower.includes('session has expired') ||
      lower.includes('session timed out') ||
      lower.includes('sign in to your account') ||
      lower.includes('author login') ||
      lower.includes('log in to editorial manager') ||
      lower.includes('you are not logged in') ||
      lower.includes('please log in') ||
      lower.includes('log in again')) &&
    (lower.includes('password') ||
      lower.includes('username') ||
      lower.includes('forgot your login') ||
      lower.includes('email') ||
      lower.includes('sign in'));

  // Editorial Manager login page HTML (often shows Username + Role + Login + Update My Information without "password")
  const isEmLoginPage =
    !hasAnyTableHeader &&
    !hasManuscriptNumber &&
    lower.includes('editorial manager') &&
    lower.includes('username') &&
    (lower.includes('login') ||
      lower.includes('forgot your login') ||
      lower.includes('send login details'));

  // Elsevier ID 2-step sign-in (step 1 shows email / institutional sign-in before password screen)
  const isElsevierIdLogin =
    !hasAnyTableHeader &&
    !hasManuscriptNumber &&
    lower.includes('elsevier') &&
    (lower.includes('enter your email') ||
      lower.includes('sign in to continue') ||
      lower.includes('institutional sign in') ||
      (lower.includes('sign in') && (lower.includes('create account') || lower.includes('id.elsevier.com'))));

  // Cloudflare / Bot verification interstitial
  const isBotWall =
    !hasAnyTableHeader &&
    !hasManuscriptNumber &&
    ((lower.includes('checking your browser') && lower.includes('cloudflare')) ||
      lower.includes('verify you are human') ||
      lower.includes('enable javascript and cookies to continue'));

  if (hasExplicitAuthPrompt || isEmLoginPage || isElsevierIdLogin || isBotWall) {
    return {
      ok: true,
      pageState: 'sign_in_needed',
      papers: [],
      error:
        'Sign-in needed. Open this portal in your browser with the Companion Extension connected, or use "Paste text".',
    };
  }

  // Empty Elsevier AuthorHub Vue/cookie shell (HTTP 200 HTML without client-side XHR hydration)
  const isAuthorHubContext =
    lower.includes('track your submission') ||
    lower.includes('track your accepted') ||
    sourceUrl.toLowerCase().includes('authorhub.elsevier.com');
  const hasCookieShell =
    lower.includes('we use cookies') ||
    (lower.includes('terms and conditions') && lower.includes('privacy policy'));
  const hasAnyStatusOrDateSignal =
    lines.some((l) => Boolean(matchStatusInLine(l))) || /\b20\d{2}\b/.test(cleanedText);

  if (isAuthorHubContext && hasCookieShell && !hasManuscriptNumber && !hasAnyStatusOrDateSignal) {
    return {
      ok: true,
      pageState: 'sign_in_needed',
      papers: [],
      error:
        'AuthorHub details load inside your signed-in browser tab. Keep the AuthorHub tab open with the Companion Extension connected (or use "Paste text").',
    };
  }

  if (lower.includes('404 not found') || lower.includes('page not found')) {
    return { ok: true, pageState: 'not_found', papers: [] };
  }

  if (
    !hasAnyTableHeader &&
    !hasManuscriptNumber &&
    lower.includes('author main menu') &&
    (lower.includes('submissions being processed') || lower.includes('submit new manuscript'))
  ) {
    return {
      ok: true,
      pageState: 'sign_in_needed',
      papers: [],
      error:
        'This tab is on the Editorial Manager Main Menu. Open "Submissions Being Processed" inside that portal tab, then refresh.',
      technicalDetails: 'Author Main Menu navigation screen detected without manuscript rows.',
    };
  }

  // 1. Check for tabular multi-paper rows (separated by | or \t)
  const firstHeaderIdx = lines.findIndex((l) => isTableHeaderLine(l).isHeader);

  if (firstHeaderIdx !== -1) {
    let { sep } = isTableHeaderLine(lines[firstHeaderIdx]);
    if (sep) {
      let headers = lines[firstHeaderIdx]
        .split(sep)
        .map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
      const papers: ExtractedPaper[] = [];
      const seenRowKeys = new Set<string>();

      for (let i = firstHeaderIdx + 1; i < lines.length; i++) {
        const row = lines[i];
        if (row === '--- PAGE TEXT ---' || row === '--- FRAME ---' || row === '--- TABLE ---') {
          if (row === '--- PAGE TEXT ---' && papers.length > 0 && sep === '|') {
            while (
              i + 1 < lines.length &&
              lines[i + 1] !== '--- FRAME ---' &&
              lines[i + 1] !== '--- TABLE ---'
            ) {
              i++;
            }
          }
          continue;
        }
        const headerCheck = isTableHeaderLine(row);
        if (headerCheck.isHeader && headerCheck.sep) {
          sep = headerCheck.sep;
          headers = row
            .split(sep)
            .map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
          continue;
        }

        if (!row.includes(sep)) continue;
        let cells = row.split(sep).map((c) => c.trim());
        if (cells.length < 2) continue;

        const msHeaderIdx = headers.findIndex(
          (h) =>
            h === 'manuscript number' ||
            h === 'manuscript id' ||
            h.includes('manuscript')
        );
        if (
          cells.length < headers.length &&
          msHeaderIdx > 0 &&
          headers[0].includes('action') &&
          ACADEMIC_MS_REGEX.test(cells[0])
        ) {
          const padCount = Math.min(msHeaderIdx, headers.length - cells.length);
          cells = [...Array(padCount).fill(''), ...cells];
        }

        if (cells.filter(Boolean).length < 2) continue;

        const getCol = (
          exactKeywords: string[],
          partialKeywords: string[],
          excludeSubstrings: string[] = []
        ): string | null => {
          for (const kw of exactKeywords) {
            const idx = headers.findIndex(
              (h) => h === kw && !excludeSubstrings.some((ex) => h.includes(ex))
            );
            if (idx !== -1 && cells[idx]) return cells[idx];
          }
          for (const kw of partialKeywords) {
            const idx = headers.findIndex(
              (h) => h.includes(kw) && !excludeSubstrings.some((ex) => h.includes(ex))
            );
            if (idx !== -1 && cells[idx]) return cells[idx];
          }
          return null;
        };

        const msRaw = getCol(
          ['manuscript number', 'manuscript id', 'submission id', 'ms #', 'ms'],
          ['manuscript number', 'manuscript', 'submission id', 'ms #'],
          ['date', 'title', 'type']
        );
        const { manuscriptNumber, revision } = splitManuscriptNumberAndRevision(msRaw);

        const subDateRaw = getCol(
          ['initial date submitted', 'submission date', 'date submitted', 'submitted'],
          ['initial date submitted', 'submission date', 'submitted', 'submission began'],
          ['type', 'status']
        );
        const statusDateRaw = getCol(
          ['status date', 'current status date', 'last status change date', 'last updated'],
          ['status date', 'last status', 'date of status', 'updated'],
          []
        );

        const subParsed = subDateRaw
          ? parseDateToken(subDateRaw)
          : { iso: null, ambiguous: false };
        const stParsed = statusDateRaw
          ? parseDateToken(statusDateRaw)
          : { iso: null, ambiguous: false };
        const uncertainFields: string[] = [];
        if (subParsed.ambiguous) uncertainFields.push('submissionDate');
        if (stParsed.ambiguous) uncertainFields.push('statusDate');

        const title = getCol(
          ['title', 'article title', 'paper title', 'manuscript title'],
          ['title'],
          ['journal', 'page']
        );

        let status = getCol(
          [
            'current status',
            'editorial status',
            'manuscript status',
            'submission status',
            'status',
            'stage',
            'state',
          ],
          ['current status', 'status', 'stage'],
          ['date', 'time', 'changed', 'updated']
        );
        if (status && isLikelyDateString(status)) {
          status = null;
        }
        if (!status) {
          for (const cellVal of cells) {
            if (!cellVal || cellVal.length > 90) continue;
            const matchedCellStatus = matchStatusInLine(cellVal);
            if (matchedCellStatus) {
              status = matchedCellStatus;
              break;
            }
          }
        }

        if (!title && !status && !manuscriptNumber) continue;

        const journalCol = getCol(['journal name', 'journal title', 'journal'], ['journal']);
        const resolvedJournal =
          journalCol && !isBadOrGenericJournalName(journalCol)
            ? journalCol
            : resolveJournalNameFromHints({
                pageText: cleanedText,
                pageTitle,
                sourceUrl,
                manuscriptNumber,
              });

        if (manuscriptNumber || title) {
          const dedupKey = `${(manuscriptNumber || '').toUpperCase()}::${(revision || '').toUpperCase()}::${(title || '').toLowerCase().slice(0, 60)}`;
          if (seenRowKeys.has(dedupKey)) continue;
          seenRowKeys.add(dedupKey);
        }

        papers.push({
          journalName: resolvedJournal,
          title,
          manuscriptNumber,
          revision,
          submissionType: getCol(['submission type', 'article type'], ['submission type', 'type'], ['date']),
          submissionDate: subParsed.iso,
          submissionDateAmbiguous: subParsed.ambiguous,
          currentStatus: status,
          statusDate: stParsed.iso,
          statusDateAmbiguous: stParsed.ambiguous,
          editorOrTeam: getCol(['handling editor', 'editor', 'editorial team'], ['editor', 'handling']),
          reviewCount: null,
          decision: getCol(['decision', 'editorial decision'], ['decision'], ['date']),
          uncertainFields,
          pageEventHistory: [],
        });
      }

      if (papers.length > 0) {
        // If table extraction only picked up a timeline/status table without MS# or Title
        // (e.g. AuthorHub or Research Square timeline table), enrich with single-paper parser!
        const allMissingIdentity = papers.every((p) => !p.manuscriptNumber && !p.title);
        if (allMissingIdentity) {
          const singleRes = parseSinglePaperKeyValueSection(
            lines,
            cleanedText,
            sourceUrl,
            pageTitle
          );
          if (singleRes.hasTrackingSignals) {
            const firstTableRow = papers[0];
            const merged: ExtractedPaper = {
              ...singleRes.paper,
              currentStatus: singleRes.paper.currentStatus || firstTableRow.currentStatus,
              statusDate: singleRes.paper.statusDate || firstTableRow.statusDate,
              submissionDate: singleRes.paper.submissionDate || firstTableRow.submissionDate,
              journalName: singleRes.paper.journalName || firstTableRow.journalName,
            };
            return validateExtractedResult({ pageState: 'ok', papers: [merged] }, cleanedText, {
              sourceUrl,
              pageTitle,
            });
          }
        }

        // Scan ALL --- PAGE TEXT --- sections for any additional manuscript IDs missed by DOM table extraction
        const capturedMsSet = new Set(
          papers
            .map((p) => (p.manuscriptNumber || '').replace(/[\s._-]+R\d+$/i, '').toUpperCase())
            .filter(Boolean)
        );
        const pageTextIndices: number[] = [];
        for (let idx = 0; idx < lines.length; idx++) {
          if (lines[idx] === '--- PAGE TEXT ---') pageTextIndices.push(idx);
        }
        for (const pageTextIdx of pageTextIndices) {
          let endSectionIdx = lines.length;
          for (let j = pageTextIdx + 1; j < lines.length; j++) {
            if (lines[j] === '--- FRAME ---' || lines[j] === '--- TABLE ---') {
              endSectionIdx = j;
              break;
            }
          }
          const extraLines = lines.slice(pageTextIdx + 1, endSectionIdx);
          const missingMsIndices: Array<{ idx: number; msRaw: string }> = [];
          for (let i = 0; i < extraLines.length; i++) {
            const l = extraLines[i];
            if (/^(page title:|journal banner:|heading 1:|heading 2:|source site|https?:\/\/)/i.test(l))
              continue;
            const m = l.match(ACADEMIC_MS_REGEX);
            if (m) {
              const norm = m[1].replace(/[\s._-]+R\d+$/i, '').toUpperCase();
              if (!capturedMsSet.has(norm)) {
                missingMsIndices.push({ idx: i, msRaw: m[1] });
                capturedMsSet.add(norm);
              }
            }
          }
          for (let k = 0; k < missingMsIndices.length; k++) {
            const start = missingMsIndices[k].idx;
            const end =
              k + 1 < missingMsIndices.length
                ? missingMsIndices[k + 1].idx
                : Math.min(extraLines.length, start + 14);
            const block = extraLines.slice(start, end);
            const { manuscriptNumber, revision } = splitManuscriptNumberAndRevision(
              missingMsIndices[k].msRaw
            );
            let title: string | null = null;
            let status: string | null = null;
            const dates: Array<{ iso: string; ambiguous: boolean }> = [];
            for (const bLine of block) {
              if (bLine.includes(missingMsIndices[k].msRaw)) {
                const remainder = bLine.replace(missingMsIndices[k].msRaw, '').trim();
                if (remainder.length > 15 && !isActionBoilerplate(remainder) && !title) {
                  title = remainder;
                }
                continue;
              }
              if (isActionBoilerplate(bLine)) continue;
              if (isLikelyDateString(bLine)) {
                const pd = parseDateToken(bLine);
                if (pd.iso) dates.push({ iso: pd.iso, ambiguous: pd.ambiguous });
                continue;
              }
              const matchedStatus = matchStatusInLine(bLine);
              if (matchedStatus && !status) {
                status = matchedStatus;
                continue;
              }
              if (!title && bLine.length >= 12) {
                title = bLine;
              } else if (!status && bLine.length >= 3 && bLine.length <= 60 && !isLikelyDateString(bLine)) {
                status = bLine;
              }
            }
            if (title || status || manuscriptNumber) {
              const subDate = dates[0] || { iso: null, ambiguous: false };
              const stDate = dates[1] || dates[0] || { iso: null, ambiguous: false };
              papers.push({
                journalName: resolveJournalNameFromHints({
                  pageText: cleanedText,
                  pageTitle,
                  sourceUrl,
                  manuscriptNumber,
                }),
                title,
                manuscriptNumber,
                revision,
                submissionType: null,
                submissionDate: subDate.iso,
                submissionDateAmbiguous: subDate.ambiguous,
                currentStatus: status,
                statusDate: stDate.iso,
                statusDateAmbiguous: stDate.ambiguous,
                editorOrTeam: null,
                reviewCount: null,
                decision: null,
                uncertainFields: [],
                pageEventHistory: [],
              });
            }
          }
        }
        return validateExtractedResult({ pageState: 'ok', papers }, cleanedText, {
          sourceUrl,
          pageTitle,
        });
      }
    }
  }

  // 2. Multi-row (or stacked single-row) Editorial Manager / tracker copy WITHOUT pipes or tabs
  const hasStackedTableHeaders =
    lines.some((l) => /^manuscript\s*number$/i.test(l)) &&
    lines.some((l) => /^current\s*status$/i.test(l));

  const msLineIndices: Array<{ idx: number; msRaw: string }> = [];
  const seenMsLineKeys = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (/^(page title:|journal banner:|heading 1:|heading 2:|source site|https?:\/\/)/i.test(lines[i]))
      continue;
    const match = lines[i].match(ACADEMIC_MS_REGEX);
    if (match && !/^(?:manuscript\s*(?:number|id)|submission\s*id|reference)\s*:/i.test(lines[i])) {
      const norm = match[1].replace(/[\s._-]+R\d+$/i, '').toUpperCase();
      if (!seenMsLineKeys.has(norm)) {
        seenMsLineKeys.add(norm);
        msLineIndices.push({ idx: i, msRaw: match[1] });
      }
    }
  }

  if (
    msLineIndices.length >= 2 ||
    (msLineIndices.length === 1 && (hasAnyTableHeader || hasStackedTableHeaders))
  ) {
    const blockPapers: ExtractedPaper[] = [];
    for (let k = 0; k < msLineIndices.length; k++) {
      const start = msLineIndices[k].idx;
      const end =
        k + 1 < msLineIndices.length
          ? msLineIndices[k + 1].idx
          : Math.min(lines.length, start + 14);
      const block = lines.slice(start, end);
      const { manuscriptNumber, revision } = splitManuscriptNumberAndRevision(
        msLineIndices[k].msRaw
      );

      let title: string | null = null;
      let status: string | null = null;
      const dates: Array<{ iso: string; ambiguous: boolean }> = [];

      for (const bLine of block) {
        if (bLine.includes(msLineIndices[k].msRaw)) {
          const remainder = bLine.replace(msLineIndices[k].msRaw, '').trim();
          if (remainder.length > 15 && !isActionBoilerplate(remainder) && !title) {
            title = remainder;
          }
          continue;
        }
        if (isActionBoilerplate(bLine) || KNOWN_FIELD_LABEL_RE.test(bLine)) continue;

        if (isLikelyDateString(bLine)) {
          const parsedDate = parseDateToken(bLine);
          if (parsedDate.iso) dates.push({ iso: parsedDate.iso, ambiguous: parsedDate.ambiguous });
          continue;
        }

        const matchedStatus = matchStatusInLine(bLine);
        if (matchedStatus && !status) {
          status = matchedStatus;
          continue;
        }

        if (!title && bLine.length >= 12) {
          title = bLine;
        } else if (!status && bLine.length >= 3 && bLine.length <= 60 && !isLikelyDateString(bLine)) {
          status = bLine;
        }
      }

      const subDate = dates[0] || { iso: null, ambiguous: false };
      const stDate = dates[1] || dates[0] || { iso: null, ambiguous: false };
      const uncertainFields: string[] = [];
      if (subDate.ambiguous) uncertainFields.push('submissionDate');
      if (stDate.ambiguous) uncertainFields.push('statusDate');

      const resolvedJournal = resolveJournalNameFromHints({
        pageText: cleanedText,
        pageTitle,
        sourceUrl,
        manuscriptNumber,
      });

      if (title || status) {
        blockPapers.push({
          journalName: resolvedJournal,
          title,
          manuscriptNumber,
          revision,
          submissionType: null,
          submissionDate: subDate.iso,
          submissionDateAmbiguous: subDate.ambiguous,
          currentStatus: status,
          statusDate: stDate.iso,
          statusDateAmbiguous: stDate.ambiguous,
          editorOrTeam: null,
          reviewCount: null,
          decision: null,
          uncertainFields,
          pageEventHistory: [],
        });
      }
    }

    if (blockPapers.length > 0) {
      return validateExtractedResult(
        { pageState: 'ok', papers: blockPapers },
        cleanedText,
        { sourceUrl, pageTitle }
      );
    }
  }

  // 3. Single-paper key-value + AuthorHub / Research Square layout parser
  const singleRes = parseSinglePaperKeyValueSection(
    lines,
    cleanedText,
    sourceUrl,
    pageTitle
  );
  if (!singleRes.hasTrackingSignals) {
    return {
      ok: false,
      pageState: 'ai_error',
      papers: [],
      error:
        'Built-in Local Reader could not recognize fields on this page layout. Switch to Smart Local + Free Open AI in Settings or use Add by hand.',
    };
  }

  return validateExtractedResult({ pageState: 'ok', papers: [singleRes.paper] }, cleanedText, {
    sourceUrl,
    pageTitle,
  });
}
