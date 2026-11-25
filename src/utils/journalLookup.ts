export const EDITORIAL_MANAGER_JOURNAL_CODES: Record<string, string> = {
  NARR: 'Natural Resources Research',
  JFUE: 'Fuel',
  FUEL: 'Fuel',
  PECS: 'Progress in Energy and Combustion Science',
  REF: 'Renewable Energy Focus',
  EST: 'Journal of Energy Storage',
  ECM: 'Energy Conversion and Management',
  ECMX: 'Energy Conversion and Management: X',
  ENCONMAN: 'Energy Conversion and Management',
  APEN: 'Applied Energy',
  RENENE: 'Renewable Energy',
  SOLENER: 'Solar Energy',
  IJHE: 'International Journal of Hydrogen Energy',
  SEGY: 'Sustainable Energy Technologies and Assessments',
  SETA: 'Sustainable Energy Technologies and Assessments',
  EGY: 'Energy',
  ENER: 'Energy',
  DES: 'Desalination',
  JCLP: 'Journal of Cleaner Production',
  JCLEPRO: 'Journal of Cleaner Production',
  RSER: 'Renewable and Sustainable Energy Reviews',
  ATE: 'Applied Thermal Engineering',
  APTHERM: 'Applied Thermal Engineering',
  CSTE: 'Case Studies in Thermal Engineering',
  JWPE: 'Journal of Water Process Engineering',
  EGYR: 'Energy Reports',
  AEJ: 'Alexandria Engineering Journal',
  HELIYON: 'Heliyon',
  ENPOL: 'Energy Policy',
  CNF: 'Combustion and Flame',
  COMBFLAME: 'Combustion and Flame',
  PROCI: 'Proceedings of the Combustion Institute',
  IJER: 'International Journal of Energy Research',
  CEJ: 'Chemical Engineering Journal',
  CHEMENG: 'Chemical Engineering Journal',
  FPT: 'Fuel Processing Technology',
  BIORT: 'Bioresource Technology',
  EP: 'Environmental Pollution',
  STOTEN: 'Science of The Total Environment',
  JMEMSCI: 'Journal of Membrane Science',
  SEPPUR: 'Separation and Purification Technology',
  IJGGC: 'International Journal of Greenhouse Gas Control',
  ERSS: 'Energy Research & Social Science',
  ECP: 'Energy Conversion and Management',
  RESCONREC: 'Resources, Conservation and Recycling',
  JHM: 'Journal of Hazardous Materials',
  WASTE: 'Waste Management',
  JEM: 'Journal of Environmental Management',
  JES: 'Journal of Environmental Sciences',
  CSCM: 'Case Studies in Construction Materials',
  ENERGY: 'Energy',
};

const MONTH_NAME_PATTERN =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_ONLY_REGEXES = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/,
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/,
  new RegExp(
    `^\\d{1,2}[\\s\\-.,]+${MONTH_NAME_PATTERN}\\.?[\\s\\-.,]+\\d{2,4}$`,
    'i'
  ),
  new RegExp(
    `^${MONTH_NAME_PATTERN}\\.?[\\s\\-]+\\d{1,2}(?:st|nd|rd|th)?(?:,|\\s)+\\d{2,4}$`,
    'i'
  ),
  new RegExp(`^${MONTH_NAME_PATTERN}\\.?\\s+\\d{4}$`, 'i'),
];

export function isLikelyDateString(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  return DATE_ONLY_REGEXES.some((re) => re.test(trimmed));
}

function isGenericBannerOrTitle(candidate: string): boolean {
  const lower = candidate.trim().toLowerCase();
  if (lower.length < 3 || lower.length > 140) return true;
  const exactIgnored = new Set([
    'editorial manager',
    'editorial manager®',
    'elsevier',
    'springer',
    'authorhub',
    'elsevier authorhub',
    'track your submission',
    'research square',
    'submissions being processed',
    'submissions being processed for author',
    'revisions being processed for author',
    'submissions with a decision',
    'author main menu',
    'main menu',
    'login',
    'sign in',
    'unknown',
    'journal not shown',
    'not shown',
    'non solus',
    'non solus logo',
    'arrow icon',
    'arrow',
  ]);
  if (exactIgnored.has(lower)) return true;
  if (/^editorial manager[®™]?$/i.test(lower)) return true;
  if (/^(logo|banner|header|icon|menu|home|arrow|chevron|caret|close|search)$/i.test(lower)) return true;
  if (
    /\b(logo|non solus|brandmark|emblem|favicon|icon|arrow|chevron|caret|spinner|loading|avatar|badge|tooltip|illustration|graphic|placeholder|button|close|download)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

export function isBadOrGenericJournalName(name: string | null | undefined): boolean {
  if (!name) return true;
  return isGenericBannerOrTitle(name);
}

export function stripRevisionTagFromTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .replace(/^\s*\[\s*(?:\d+(?:st|nd|rd|th)?\s+revision|revision\s*\d*|r\d+)\s*\]\s*/i, '')
    .replace(/^\s*(?:revised|revision)\s*:\s*/i, '')
    .trim();
}

export function normalizeTitleForMatch(title: string | null | undefined): string {
  const clean = stripRevisionTagFromTitle(title)
    .replace(/\.{3,}$/, '')
    .replace(/…$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean === 'untitled manuscript' || clean === 'untitled') return '';
  return clean;
}

export function titlesMatchForMerge(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeTitleForMatch(a);
  const nb = normalizeTitleForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length >= 18 && longer.startsWith(shorter)) {
    return true;
  }

  // Word-overlap check for minor subtitle/punctuation/truncation differences across portals
  const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'to', 'with', 'by', 'from']);
  const wordsA = na.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));
  const wordsB = nb.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));
  if (wordsA.length >= 4 && wordsB.length >= 4) {
    const setB = new Set(wordsB);
    const shared = wordsA.filter((w) => setB.has(w)).length;
    const minLen = Math.min(wordsA.length, wordsB.length);
    if (shared / minLen >= 0.8) {
      return true;
    }
  }
  return false;
}

export function extractManuscriptPrefixCode(
  manuscriptNumber: string | null | undefined
): string | null {
  if (!manuscriptNumber) return null;
  const clean = manuscriptNumber.trim().toUpperCase();
  // Matches REF-D-26-01176R2, NARR-D-26-02069, JFUE-D-26-15464, PECS-D-26-00228, EST-26-1234, etc.
  const match =
    clean.match(/^([A-Z]{2,12})-(?:[A-Z]-)?\d{2,4}-/) ||
    clean.match(/^([A-Z]{2,12})_\d{2,4}_/);
  return match ? match[1] : null;
}

export function extractPortalSlugFromUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase().includes('editorialmanager.com')) {
      const firstSegment = parsed.pathname
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)[0];
      if (
        firstSegment &&
        !/^(default\.aspx|login\.aspx|em|app|api)$/i.test(firstSegment)
      ) {
        return firstSegment.toUpperCase();
      }
    }
  } catch {
    // ignore malformed url
  }
  return null;
}

export function resolveJournalNameFromHints(opts: {
  pageText?: string | null;
  pageTitle?: string | null;
  sourceUrl?: string | null;
  manuscriptNumber?: string | null;
}): string | null {
  // 1. Check verified Editorial Manager / Elsevier / Springer manuscript code prefix first
  const msPrefix = extractManuscriptPrefixCode(opts.manuscriptNumber);
  if (msPrefix && EDITORIAL_MANAGER_JOURNAL_CODES[msPrefix]) {
    return EDITORIAL_MANAGER_JOURNAL_CODES[msPrefix];
  }

  const headerSlice = (opts.pageText || '').slice(0, 3500);
  const titleText = (opts.pageTitle || '').trim();

  // 2. Explicit banner / meta / "Editorial Manager for <Journal>" / "Submitted to <Journal>"
  const candidates: string[] = [];

  for (const src of [titleText, headerSlice]) {
    if (!src) continue;
    const bannerMatch = src.match(/Journal Banner\s*:\s*([^\n|]{3,110})/i);
    if (bannerMatch?.[1]) candidates.push(bannerMatch[1]);

    const emForMatch = src.match(
      /Editorial Manager[®™]?\s*(?:for|[-–|])\s*([^\n|®™]{3,100})/i
    );
    if (emForMatch?.[1]) candidates.push(emForMatch[1]);

    const submittedToMatch = src.match(
      /(?:Submitted to|Published in|Journal Name\s*:|Journal Title\s*:)\s*([^\n|•]{3,100})/i
    );
    if (submittedToMatch?.[1]) candidates.push(submittedToMatch[1]);
  }

  for (const rawCandidate of candidates) {
    const cleaned = rawCandidate
      .replace(/\s*[-–|]\s*Editorial Manager.*$/i, '')
      .replace(/\s*[-–|]\s*Elsevier.*$/i, '')
      .replace(/\s*[-–|]\s*Author.*$/i, '')
      .trim();
    if (!isGenericBannerOrTitle(cleaned)) {
      return cleaned;
    }
  }

  // 3. Check Editorial Manager URL portal slug (e.g. editorialmanager.com/jfue/)
  const urlSlug = extractPortalSlugFromUrl(opts.sourceUrl);
  if (urlSlug && EDITORIAL_MANAGER_JOURNAL_CODES[urlSlug]) {
    return EDITORIAL_MANAGER_JOURNAL_CODES[urlSlug];
  }

  return null;
}
