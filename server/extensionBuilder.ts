import JSZip from 'jszip';

export async function buildCrossBrowserExtensionZip(dashboardOrigin: string): Promise<Buffer> {
  const zip = new JSZip();

  let customOriginMatch: string | null = null;
  try {
    const parsedOrigin = new URL(dashboardOrigin);
    if (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') {
      customOriginMatch = `${parsedOrigin.origin}/*`;
    }
  } catch {
    customOriginMatch = null;
  }

  const contentScriptMatches = Array.from(
    new Set(
      [
        'http://localhost:3000/*',
        'http://127.0.0.1:3000/*',
        'https://*.run.app/*',
        'https://*.onrender.com/*',
        customOriginMatch,
      ].filter((m): m is string => Boolean(m))
    )
  );

  const manifest = {
    manifest_version: 3,
    name: 'Journal Paper Dashboard Companion',
    version: '1.2.2',
    description:
      'Refreshes your open, signed-in journal tracker tabs (Editorial Manager, Elsevier AuthorHub, Research Square) in Edge, Chrome, and Firefox before reading page text. Never opens any tabs.',
    permissions: ['tabs', 'scripting', 'activeTab'],
    host_permissions: ['<all_urls>'],
    background: {
      service_worker: 'background.js',
      scripts: ['background.js'],
    },
    action: {
      default_title: 'Journal Paper Dashboard',
      default_popup: 'popup.html',
    },
    content_scripts: [
      {
        matches: contentScriptMatches,
        js: ['dashboard_bridge.js'],
        run_at: 'document_idle',
        all_frames: true,
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'journal-paper-dashboard@local.extension',
        strict_min_version: '109.0',
      },
    },
  };

  const backgroundJs = `const api = typeof browser !== 'undefined' ? browser : chrome;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reloadAndWaitForTab(tabId, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      api.tabs.onUpdated.removeListener(listener);
      // Even if slow resources are still pending, proceed if document already loaded enough,
      // otherwise reject cleanly
      resolve();
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        api.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    api.tabs.onUpdated.addListener(listener);
    try {
      const maybePromise = api.tabs.reload(tabId, { bypassCache: true });
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          api.tabs.onUpdated.removeListener(listener);
          reject(err);
        });
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        api.tabs.onUpdated.removeListener(listener);
        reject(err);
      }
    }
  });
}

function findAllMatchingOpenTabs(allTabs, targetUrl) {
  const normalizedTarget = targetUrl.split('#')[0];
  let parsedTarget = null;
  try {
    parsedTarget = new URL(targetUrl);
  } catch (_) {}

  const seenIds = new Set();
  const ordered = [];
  const pushUnique = (list) => {
    for (const t of list) {
      if (t && t.id && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        ordered.push(t);
      }
    }
  };

  // 1. Exact URL match (without hash)
  pushUnique(allTabs.filter((t) => t.url && t.url.split('#')[0] === normalizedTarget));

  if (parsedTarget) {
    const targetUuid = parsedTarget.searchParams.get('uuid');
    // 2. Elsevier AuthorHub UUID match
    if (targetUuid) {
      pushUnique(
        allTabs.filter((t) => {
          if (!t.url) return false;
          try {
            const u = new URL(t.url);
            return u.hostname === parsedTarget.hostname && u.searchParams.get('uuid') === targetUuid;
          } catch (_) {
            return false;
          }
        })
      );
    }

    // 3. Same Editorial Manager journal portal slug (e.g., editorialmanager.com/est/)
    if (parsedTarget.hostname.toLowerCase().includes('editorialmanager.com')) {
      const targetSlug = parsedTarget.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      if (targetSlug) {
        pushUnique(
          allTabs.filter((t) => {
            if (!t.url) return false;
            try {
              const u = new URL(t.url);
              if (!u.hostname.toLowerCase().includes('editorialmanager.com')) return false;
              const tabSlug = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
              return tabSlug === targetSlug;
            } catch (_) {
              return false;
            }
          })
        );
      }
    }

    // 4. Same origin + pathname (when no conflicting uuid)
    if (!targetUuid) {
      const targetPath = (parsedTarget.origin + parsedTarget.pathname).replace(/\\/$/, '').toLowerCase();
      pushUnique(
        allTabs.filter((t) => {
          if (!t.url) return false;
          try {
            const u = new URL(t.url);
            return (u.origin + u.pathname).replace(/\\/$/, '').toLowerCase() === targetPath;
          } catch (_) {
            return false;
          }
        })
      );
    }
  }

  return ordered;
}

async function extractTextFromTab(tabId) {
  const results = await api.scripting.executeScript({
    target: { tabId },
    func: () => {
      const parts = [];
      const bannerHints = [];

      const metaSelectors = [
        'meta[name="citation_journal_title"]',
        'meta[property="og:site_name"]',
      ];
      metaSelectors.forEach((sel) => {
        const el = document.querySelector(sel);
        const content = el && el.getAttribute('content');
        if (content && content.trim() && !/\\b(logo|non solus|elsevier|authorhub)\\b/i.test(content)) {
          bannerHints.push(content.trim());
        }
      });

      document.querySelectorAll('img[alt]').forEach((img) => {
        const alt = (img.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim();
        if (
          alt.length >= 3 &&
          alt.length <= 100 &&
          !/^(logo|banner|icon|button|help|elsevier|springer|editorial manager|authorhub|research square|arrow|chevron|caret)$/i.test(alt) &&
          !/\\b(logo|non solus|brandmark|emblem|favicon|icon|arrow|chevron|caret|spinner|loading|avatar|badge|tooltip|illustration|graphic|placeholder|button|close|download)\\b/i.test(alt)
        ) {
          if (!bannerHints.includes(alt)) bannerHints.push(alt);
        }
      });

      if (document.title) {
        parts.push('Page Title: ' + document.title.trim());
      }
      if (bannerHints.length > 0) {
        parts.push('Journal Banner: ' + bannerHints.slice(0, 3).join(' | '));
      }

      const h1 = document.querySelector('h1');
      if (h1 && h1.innerText) {
        const h1Text = h1.innerText.replace(/\\s+/g, ' ').trim();
        if (h1Text.length >= 8 && !/^(track your submission|authorhub|editorial manager|research square|submissions being processed)/i.test(h1Text)) {
          parts.push('Heading 1: ' + h1Text);
        }
      }
      const h2 = document.querySelector('h2');
      if (h2 && h2.innerText) {
        const h2Text = h2.innerText.replace(/\\s+/g, ' ').trim();
        if (h2Text.length >= 8 && !/^(track your submission|authorhub|editorial manager|research square|submissions being processed|timeline|submission details)/i.test(h2Text)) {
          parts.push('Heading 2: ' + h2Text);
        }
      }

      function collectDoc(doc, depth = 0) {
        if (!doc || depth > 3) return;
        const cleanTables = [];
        try {
          doc.querySelectorAll('table').forEach((tbl) => {
            const rows = Array.from(tbl.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr'));
            if (rows.length < 2) return;
            const tableLines = [];
            rows.forEach((tr) => {
              // Skip outer layout wrapper rows that hold another multi-row DATA table,
              // but keep manuscript rows whose Action cell contains a small 1-2 col helper table.
              const hasMultiRowDataNestedTable = Array.from(tr.querySelectorAll('table')).some((inner) => {
                const innerRows = inner.querySelectorAll('tr');
                if (innerRows.length <= 1) return false;
                const hasWideRow = Array.from(innerRows).some(
                  (r) => Array.from(r.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH').length >= 3
                );
                const innerTxt = (inner.innerText || '').toLowerCase();
                return hasWideRow || /manuscript\\s*number|current\\s*status|initial\\s*date/.test(innerTxt);
              });
              if (hasMultiRowDataNestedTable) return;
              const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
              if (cells.length >= 2) {
                const line = cells.map((c) => (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ');
                if (line.replace(/[|\\s]/g, '').length > 0) tableLines.push(line);
              }
            });
            const joined = tableLines.join('\\n');
            if (/manuscript|title|status/i.test(joined)) {
              cleanTables.push(joined);
            }
          });
        } catch (_) {}

        if (cleanTables.length > 0) {
          parts.push(cleanTables.join('\\n--- TABLE ---\\n'));
        }
        if (doc.body && doc.body.innerText) {
          parts.push('--- PAGE TEXT ---\\n' + doc.body.innerText);
        }
        const frames = doc.querySelectorAll('iframe, frame');
        frames.forEach((f) => {
          try {
            if (f.contentDocument) collectDoc(f.contentDocument, depth + 1);
          } catch (_) {
            // Cross-origin frame ignored safely
          }
        });
      }
      collectDoc(document);
      return {
        text: parts.join('\\n--- FRAME ---\\n'),
        title: document.title || '',
        url: window.location.href,
      };
    },
  });

  if (!results || !results[0] || !results[0].result) {
    throw new Error('Could not read page text from tab');
  }
  return results[0].result;
}

async function extractAfterSpaSettle(tabId) {
  let data = await extractTextFromTab(tabId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const bodyOnly = (data.text || '').split('--- PAGE TEXT ---')[1] || data.text || '';
    const trimmedBody = bodyOnly.trim();
    const stillLoading =
      trimmedBody.length < 180 ||
      /^(?:loading|please wait|fetching)/i.test(trimmedBody);
    if (!stillLoading) break;
    await sleep(900);
    data = await extractTextFromTab(tabId);
  }
  return data;
}

function textMatchesHints(text, hints) {
  if (!hints || !text) return false;
  const lowerText = text.toLowerCase();
  if (hints.manuscriptNumber) {
    const cleanMs = String(hints.manuscriptNumber).trim().toLowerCase();
    const baseMs = cleanMs.replace(/[\\s._-]+r\\d+$/i, '');
    if (baseMs.length >= 5 && lowerText.includes(baseMs)) return true;
  }
  if (hints.title) {
    const cleanTitle = String(hints.title).replace(/\\.{3,}$/, '').trim().toLowerCase();
    if (cleanTitle.length >= 16 && lowerText.includes(cleanTitle.slice(0, 28))) return true;
  }
  return false;
}

async function readTrackerUrl(targetUrl, hints) {
  const allTabs = await api.tabs.query({});
  const candidateTabs = findAllMatchingOpenTabs(allTabs, targetUrl);

  if (candidateTabs.length === 0) {
    return {
      ok: false,
      noOpenTab: true,
      error: 'Portal tab is not open in your browser. Open this portal tab first so it can be refreshed and read (new tabs are never opened automatically).',
    };
  }

  let fallbackData = null;
  for (let i = 0; i < candidateTabs.length; i++) {
    const tab = candidateTabs[i];
    await reloadAndWaitForTab(tab.id, 18000);
    await sleep(1600);
    const data = await extractAfterSpaSettle(tab.id);
    if (!fallbackData) fallbackData = data;
    if (candidateTabs.length === 1 || !hints || (!hints.manuscriptNumber && !hints.title) || textMatchesHints(data.text, hints)) {
      return { ok: true, usedExistingTab: true, reloadedBeforeRead: true, ...data };
    }
  }

  return { ok: true, usedExistingTab: true, reloadedBeforeRead: true, ...fallbackData };
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'JPD_PING') {
    sendResponse({ ok: true, version: '1.2.2' });
    return true;
  }

  if (message.type === 'JPD_READ_URL') {
    readTrackerUrl(message.url, message.hints)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message.type === 'JPD_CAPTURE_ACTIVE_TAB') {
    api.tabs
      .query({ active: true, currentWindow: true })
      .then(async (tabs) => {
        if (!tabs[0] || !tabs[0].id) throw new Error('No active tab found');
        await reloadAndWaitForTab(tabs[0].id, 18000);
        await sleep(1400);
        const data = await extractTextFromTab(tabs[0].id);
        sendResponse({ ok: true, ...data });
      })
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
});
`;

  const dashboardBridgeJs = `const api = typeof browser !== 'undefined' ? browser : chrome;

window.postMessage({ type: 'JPD_EXTENSION_READY', version: '1.2.2' }, window.location.origin);

api.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'JPD_PUSH_TAB_CAPTURE' && message.payload) {
    window.postMessage({ type: 'JPD_PUSH_TAB_CAPTURE', payload: message.payload }, window.location.origin);
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'JPD_CHECK_EXTENSION') {
    api.runtime.sendMessage({ type: 'JPD_PING' }, (resp) => {
      window.postMessage(
        { type: 'JPD_EXTENSION_READY', version: resp?.version || '1.2.2' },
        window.location.origin
      );
    });
  }

  if (msg.type === 'JPD_EXT_READ_URL') {
    api.runtime.sendMessage({ type: 'JPD_READ_URL', url: msg.url, hints: msg.hints }, (resp) => {
      window.postMessage(
        {
          type: 'JPD_EXT_READ_URL_RESULT',
          requestId: msg.requestId,
          result: resp || { ok: false, error: api.runtime.lastError?.message || 'Extension communication error' },
        },
        window.location.origin
      );
    });
  }
});
`;

  const popupHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; width: 320px; margin: 0; padding: 14px; color: #0f172a; background: #f8fafc; }
    h1 { font-size: 15px; margin: 0 0 6px 0; }
    p { font-size: 13px; color: #475569; margin: 0 0 12px 0; line-height: 1.4; }
    button { width: 100%; padding: 9px 12px; border: 0; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: 8px; }
    .primary { background: #0f172a; color: #fff; }
    .secondary { background: #e2e8f0; color: #0f172a; }
    #status { font-size: 12px; color: #334155; margin-top: 6px; word-break: break-word; }
  </style>
</head>
<body>
  <h1>Journal Paper Dashboard</h1>
  <p>Refreshes and reads visible text from your already-open portal tab. Never opens any browser tabs or sends passwords/cookies.</p>
  <button id="sendTab" class="primary">Refresh &amp; Read This Tab</button>
  <button id="openDash" class="secondary">Focus Open Dashboard</button>
  <div id="status"></div>
  <script src="popup.js"></script>
</body>
</html>
`;

  const popupJs = `const api = typeof browser !== 'undefined' ? browser : chrome;
const DASHBOARD_URL = ${JSON.stringify(dashboardOrigin || 'http://localhost:3000')};

function findDashboardTab(tabs) {
  return (
    tabs.find((t) => t.url && t.url.startsWith(DASHBOARD_URL)) ||
    tabs.find((t) => t.url && t.url.includes('.onrender.com')) ||
    tabs.find((t) => t.url && (t.url.includes('localhost:3000') || t.url.includes('127.0.0.1:3000'))) ||
    tabs.find((t) => t.url && t.url.includes('.run.app')) ||
    tabs.find((t) => t.url && t.url.includes('aistudio.google.com/apps'))
  );
}

async function focusTabAndWindow(tab) {
  await api.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined && api.windows && api.windows.update) {
    try {
      await api.windows.update(tab.windowId, { focused: true });
    } catch (_) {}
  }
}

document.getElementById('openDash').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  try {
    const tabs = await api.tabs.query({});
    const dashTab = findDashboardTab(tabs);
    if (dashTab && dashTab.id) {
      await focusTabAndWindow(dashTab);
      window.close();
    } else {
      statusEl.textContent = 'No open dashboard tab found. Open your Journal Paper Dashboard tab manually (this extension never opens tabs).';
    }
  } catch (err) {
    statusEl.textContent = 'Could not locate dashboard tab: ' + (err?.message || String(err));
  }
});

document.getElementById('sendTab').addEventListener('click', () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Refreshing and reading current tab...';
  api.runtime.sendMessage({ type: 'JPD_CAPTURE_ACTIVE_TAB' }, async (capture) => {
    if (!capture || !capture.ok) {
      statusEl.textContent = 'Could not read this tab: ' + (capture?.error || 'Unknown error');
      return;
    }
    const tabs = await api.tabs.query({});
    const dashTab = findDashboardTab(tabs);
    if (dashTab && dashTab.id) {
      try {
        await api.tabs.sendMessage(dashTab.id, { type: 'JPD_PUSH_TAB_CAPTURE', payload: capture });
      } catch (_) {
        try {
          await api.scripting.executeScript({
            target: { tabId: dashTab.id, allFrames: true },
            func: (payload) => {
              window.postMessage({ type: 'JPD_PUSH_TAB_CAPTURE', payload }, '*');
            },
            args: [capture],
          });
        } catch (_) {}
      }
      await focusTabAndWindow(dashTab);
      statusEl.textContent = 'Sent refreshed page text to dashboard.';
    } else {
      statusEl.textContent = 'No open dashboard tab found. Open your Journal Paper Dashboard tab manually, then try again.';
    }
  });
});
`;

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('background.js', backgroundJs);
  zip.file('dashboard_bridge.js', dashboardBridgeJs);
  zip.file('popup.html', popupHtml);
  zip.file('popup.js', popupJs);

  return zip.generateAsync({ type: 'nodebuffer' });
}
