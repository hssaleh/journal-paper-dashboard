import JSZip from 'jszip';
import type {
  DashboardSettings,
  DeletedPaperRecord,
  EmailAlertRecord,
  HistoryEntry,
  PaperRecord,
} from '../types';
import {
  computeDaysInStatus,
  computeDaysSinceSubmission,
  formatDateOnly,
  formatDateTime,
  getPaperSources,
} from './paperLogic';

type CellValue = string | number | null | undefined;

interface SheetInput {
  name: string;
  headers: string[];
  rows: CellValue[][];
  colWidths?: number[];
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnIndexToLetter(colIdx: number): string {
  let num = colIdx + 1;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters;
}

function buildWorksheetXml(sheet: SheetInput): string {
  const allRows: CellValue[][] = [sheet.headers, ...sheet.rows];
  const widths =
    sheet.colWidths ||
    sheet.headers.map((h, colIdx) => {
      let maxLen = h.length;
      for (const r of sheet.rows.slice(0, 100)) {
        const val = r[colIdx];
        if (val !== null && val !== undefined) {
          maxLen = Math.max(maxLen, String(val).length);
        }
      }
      return Math.min(Math.max(maxLen + 3, 12), 55);
    });

  const colsXml = `<cols>${widths
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
    )
    .join('')}</cols>`;

  const rowsXml = allRows
    .map((row, rIdx) => {
      const rowNum = rIdx + 1;
      const isHeader = rIdx === 0;
      const cellsXml = row
        .map((val, cIdx) => {
          const ref = `${columnIndexToLetter(cIdx)}${rowNum}`;
          if (val === null || val === undefined || val === '') {
            return `<c r="${ref}"${isHeader ? ' s="1"' : ''} t="inlineStr"><is><t></t></is></c>`;
          }
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<c r="${ref}"${isHeader ? ' s="1"' : ''}><v>${val}</v></c>`;
          }
          return `<c r="${ref}"${isHeader ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            String(val)
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  ${colsXml}
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

export async function generateDashboardExcelBlob(params: {
  papers: PaperRecord[];
  history: HistoryEntry[];
  alerts: EmailAlertRecord[];
  deletedPapers: DeletedPaperRecord[];
  settings: DashboardSettings;
}): Promise<Blob> {
  const { papers, history, alerts, deletedPapers, settings } = params;

  const papersRows: CellValue[][] = papers.map((p, idx) => {
    const sources = getPaperSources(p);
    const { days, basis } = computeDaysInStatus(p);
    const daysSinceSub = computeDaysSinceSubmission(p);
    const sourcesSummary = sources
      .map(
        (s) =>
          `${s.trackerSite}${s.currentStatus ? ` (${s.currentStatus})` : ''}`
      )
      .join('; ');
    const urlsList = sources.map((s) => s.url).join(' | ');

    return [
      idx + 1,
      p.journalName,
      p.manuscriptNumber || 'Not shown',
      p.revision || '',
      p.title,
      formatDateOnly(p.submissionDate, settings.dateFormat),
      p.currentStatus,
      formatDateOnly(p.statusDate, settings.dateFormat),
      days,
      basis,
      daysSinceSub !== null ? daysSinceSub : '',
      p.editorOrTeam || '',
      p.reviewCount !== null ? p.reviewCount : '',
      p.decision || '',
      p.health,
      p.healthMessage || '',
      formatDateTime(p.lastChangedAt, settings.timezone, settings.dateFormat),
      formatDateTime(p.lastCheckedAt, settings.timezone, settings.dateFormat),
      sources.length,
      sourcesSummary,
      urlsList,
      p.notes || '',
    ];
  });

  const historyRows: CellValue[][] = history.map((h) => [
    formatDateTime(h.detectedAt, settings.timezone, settings.dateFormat),
    h.journalName,
    h.manuscriptNumber || '',
    h.paperTitle,
    h.trackerSite,
    h.oldStatus,
    h.newStatus,
    formatDateOnly(h.statusDateFromPage, settings.dateFormat),
    h.otherChangedFields.join(', '),
    h.checkSource,
    h.isMinorUpdate ? 'Minor field update' : 'Status transition',
  ]);

  const alertRows: CellValue[][] = alerts.map((a) => [
    formatDateTime(a.createdAt, settings.timezone, settings.dateFormat),
    a.type,
    a.recipient,
    a.subject,
    a.state,
    a.attempts,
    formatDateTime(a.lastAttemptAt, settings.timezone, settings.dateFormat),
    a.lastError || '',
    a.bodyText,
  ]);

  const deletedRows: CellValue[][] = deletedPapers.map((d) => [
    formatDateTime(d.deletedAt, settings.timezone, settings.dateFormat),
    d.paper.journalName,
    d.paper.manuscriptNumber || '',
    d.paper.title,
    d.paper.currentStatus,
    d.paper.url,
  ]);

  const settingsRows: CellValue[][] = [
    ['Exported At', formatDateTime(new Date().toISOString(), settings.timezone, settings.dateFormat)],
    ['Timezone', settings.timezone],
    ['Date Format', settings.dateFormat],
    ['AI Agent', settings.aiProvider],
    ['Check Interval (min)', settings.checkIntervalMinutes],
    ['Auto Checks Paused', settings.autoCheckPausedAll ? 'Yes' : 'No'],
    ['Alert Recipient Email', settings.recipientEmail],
    ['Email Frequency', settings.emailMode],
    ['Total Active Papers', papers.length],
    ['Total History Events', history.length],
    ['Total Email Alerts', alerts.length],
    ['Total Deleted (Recoverable)', deletedPapers.length],
  ];

  const sheets: SheetInput[] = [
    {
      name: 'Papers',
      headers: [
        '#',
        'Journal',
        'Manuscript #',
        'Revision',
        'Title',
        'Submitted Date',
        'Current Status',
        'Status Date',
        'Days in Status',
        'Days Basis',
        'Days Since Submission',
        'Editor / Team',
        'Reviews Completed',
        'Decision',
        'Health',
        'Health Message',
        'Last Changed',
        'Last Checked',
        'Merged Sources Count',
        'Sources & Statuses',
        'Source URLs',
        'Notes',
      ],
      rows: papersRows,
    },
    {
      name: 'Status History',
      headers: [
        'Detected At',
        'Journal',
        'Manuscript #',
        'Paper Title',
        'Tracker Site',
        'Old Status',
        'New Status',
        'Page Status Date',
        'Other Changed Fields',
        'Check Source',
        'Event Type',
      ],
      rows: historyRows,
    },
    {
      name: 'Email Alerts',
      headers: [
        'Created At',
        'Type',
        'Recipient',
        'Subject',
        'Delivery State',
        'Attempts',
        'Last Attempt',
        'Last Error',
        'Message Body',
      ],
      rows: alertRows,
    },
    {
      name: 'Deleted Papers',
      headers: [
        'Deleted At',
        'Journal',
        'Manuscript #',
        'Title',
        'Last Status',
        'Primary URL',
      ],
      rows: deletedRows,
    },
    {
      name: 'Summary & Settings',
      headers: ['Setting / Metric', 'Value'],
      rows: settingsRows,
    },
  ];

  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n  ')}
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );

  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('\n    ')}
  </sheets>
</workbook>`
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('\n  ')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );

  sheets.forEach((s, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, buildWorksheetXml(s));
  });

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
