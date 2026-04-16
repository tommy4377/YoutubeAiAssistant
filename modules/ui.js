// ui.js - YouTube AI Assistant v5.0 - UI Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  const UTILS = window.YTAI?.UTILS;

  if (!CONSTANTS || !UTILS) {
    console.error('[YTAI UI] Dependencies missing. Ensure constants.js is loaded first.');
    return;
  }

  const {
    SVG,
    C,
    LANGUAGES,
    SEG_COLORS,
    SEG_TYPE_SPONSOR,
    SEG_TYPE_SELF_PROMO,
    SEG_TYPE_ENGAGEMENT,
    WIDGET_ID,
    FOOTER,
    KEY_GEMINI_API,  // BUG-11 fix: import constant
  } = CONSTANTS;
  const { doc, setHTML, escapeHTML, sanitizeKeypoints } = UTILS;

  // ───────────────────────────────────────────────────────────────────────────
  // Time Formatting
  // ───────────────────────────────────────────────────────────────────────────
  const fmtTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // HTML Generators
  // ───────────────────────────────────────────────────────────────────────────
  const htmlSetup = (hasGroqKey, hasGeminiKey) => {
    const groqSection = hasGroqKey ? '' : `
      <div class="ytai-setup-section">
        <h3>Groq API Key</h3>
        <p>Enter your key for AI summaries with Llama models.</p>
        <input type="password" id="ytai-key-groq" class="ytai-input" placeholder="Paste your Groq API key…" autocomplete="off" spellcheck="false">
        <a href="https://console.groq.com/keys" target="_blank" style="font-size:12px;color:${C.accent}">Get a free key on Groq Console ↗</a>
      </div>`;

    const geminiSection = hasGeminiKey ? '' : `
      <div class="ytai-setup-section" style="margin-top:20px;padding-top:20px;border-top:1px solid ${C.borderSoft}">
        <h3>Gemini API Key</h3>
        <p>Enter your key to enable AI review and enrichment.</p>
        <input type="password" id="ytai-key-gemini" class="ytai-input" placeholder="Paste your Gemini API key…" autocomplete="off" spellcheck="false">
        <a href="https://aistudio.google.com/app/apikey" target="_blank" style="font-size:12px;color:${C.accent}">Get a free key on Google AI Studio ↗</a>
      </div>`;

    const saveBtn = (!hasGroqKey || !hasGeminiKey) ? `
      <button id="ytai-save" class="ytai-btn-primary" style="margin-top:20px">Save and continue</button>
    ` : '';

    return `
      <div class="ytai-header">
        <div class="ytai-tab active" style="pointer-events:none">AI Assistant</div>
      </div>
      <div class="ytai-body ytai-body--setup" id="ytai-body">
        <div class="ytai-setup">
          <div class="ytai-setup-icon">${SVG.bulb}</div>
          ${groqSection}
          ${geminiSection}
          ${saveBtn}
        </div>
      </div>`;
  };

  const htmlMain = (tab, showTs, geminiMissing = false) => {
    return `
      <div class="ytai-header">
        <div class="ytai-tab ${tab === 'transcript' ? 'active' : ''}" data-tab="transcript">Transcript</div>
        <div class="ytai-tab ${tab === 'ai' ? 'active' : ''}" data-tab="ai">AI Summary</div>
      </div>
      <div class="ytai-body" id="ytai-body">
        <div class="ytai-loading"><span>Fetching transcript…</span></div>
      </div>
      <div class="ytai-toolbar">
        <button class="ytai-btn ${showTs ? 'on' : ''}" id="ytai-ts">${SVG.time} <span>Timestamps</span></button>
        <button class="ytai-btn" id="ytai-copy">${SVG.copy} <span id="ytai-copy-lbl">Copy</span></button>
        <button class="ytai-btn" id="ytai-dl">${SVG.download} <span id="ytai-dl-lbl">Download</span></button>
        <button class="ytai-btn ${geminiMissing ? 'on' : ''}" id="ytai-settings">${SVG.gear}</button>
      </div>`;
  };

  const htmlGeminiMissing = () => {
    return `
      <div class="ytai-error">
        <strong>Gemini API Key Required</strong><br><br>
        The AI Summary feature requires a Gemini API key for review and enrichment.<br><br>
        <a id="ytai-gemini-setup-link" style="cursor:pointer;color:${C.accent};text-decoration:underline">Open Settings</a> to add your key, or get one free from
        <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:${C.accent}">Google AI Studio ↗</a>
      </div>`;
  };

  const htmlSettings = (config) => {
    const { tl, sl, hasKey, masked, sponsorSegments, skipTypeGetter, fmtTime: fmtTimeFn } = config;

    const tOpts = LANGUAGES.map(l => `<option value="${l.value}" ${l.value === tl ? 'selected' : ''}>${l.label}</option>`).join('');
    const sOpts = LANGUAGES.map(l => `<option value="${l.value}" ${l.value === sl ? 'selected' : ''}>${l.label}</option>`).join('');

    const skipTypes = [
      { key: SEG_TYPE_SPONSOR, label: 'Skip Sponsor / Ads', desc: 'ON = auto-skip · OFF = press Enter to skip' },
      { key: SEG_TYPE_SELF_PROMO, label: 'Skip Self-Promotion', desc: 'ON = auto-skip · OFF = press Enter to skip' },
      { key: SEG_TYPE_ENGAGEMENT, label: 'Skip Engagement Calls', desc: 'ON = auto-skip · OFF = press Enter to skip' },
    ];

    const toggleRows = skipTypes.map(t => `
      <div class="ytai-toggle-row">
        <div>
          <div class="ytai-settings-label">${t.label}</div>
          <div class="ytai-settings-desc" style="margin:0">${t.desc}</div>
        </div>
        <label class="ytai-toggle">
          <input type="checkbox" data-skip-type="${t.key}" ${skipTypeGetter(t.key) ? 'checked' : ''}>
          <span class="ytai-toggle-slider"></span>
        </label>
      </div>`).join('');

    // Build detected segments list
    let segList = `<div style="font-size:12px;color:${C.muted}">No segments detected yet.</div>`;
    if (sponsorSegments?.length) {
      const items = sponsorSegments.map(s => {
        const color = SEG_COLORS[s.type] || C.warning;
        return `<li>
          <span class="ytai-sponsor-dot" style="background:${color}"></span>
          <span style="color:${color}">${escapeHTML(s.label || 'Segment')}</span>
          <span style="font-size:11px;color:${C.muted};margin-left:4px">[${s.type || '?'}]</span>
          <span style="color:${C.muted};margin-left:auto">${fmtTimeFn(s.start)} → ${fmtTimeFn(s.end)}</span>
        </li>`;
      }).join('');
      segList = `<ul class="ytai-sponsor-segments">${items}</ul>`;
    }

    const geminiMasked = config.hasGeminiKey
      ? '●●●●●●●●' + GM_getValue(KEY_GEMINI_API, '').slice(-4)  // BUG-11 fix: use constant instead of hardcoded string
      : '';

    return `
      <div class="ytai-settings">
        <div class="ytai-settings-section">
          <div class="ytai-settings-header">${SVG.key} Groq API Key</div>
          <div class="ytai-settings-row">
            <div class="ytai-settings-desc">Your Groq key from Groq Console. Never shared.</div>
            <div class="ytai-key-row">
              <input type="password" id="ytai-settings-key-groq" class="ytai-input" value="${escapeHTML(masked)}"
                placeholder="Paste new key…" autocomplete="off" spellcheck="false">
              <button id="ytai-settings-save-groq" class="ytai-btn-primary">Save</button>
            </div>
            <div class="ytai-key-status ${hasKey ? 'connected' : 'disconnected'}" id="ytai-key-status-groq">
              <span class="ytai-status-dot"></span>
              <span id="ytai-key-status-text-groq">${hasKey ? 'Connected' : 'Not configured'}</span>
              <span class="ytai-save-feedback" id="ytai-save-feedback-groq">${SVG.check} Saved</span>
            </div>
            ${hasKey ? `<button id="ytai-settings-clear-groq" class="ytai-btn-danger" style="margin-top:8px;width:fit-content">Remove key</button>` : ''}
          </div>
        </div>
        <div class="ytai-settings-section">
          <div class="ytai-settings-header">${SVG.key} Gemini API Key</div>
          <div class="ytai-settings-row">
            <div class="ytai-settings-desc">Your Gemini key from Google AI Studio. Used for AI review.</div>
            <div class="ytai-key-row">
              <input type="password" id="ytai-settings-key-gemini" class="ytai-input" value="${escapeHTML(geminiMasked)}"
                placeholder="Paste new key…" autocomplete="off" spellcheck="false">
              <button id="ytai-settings-save-gemini" class="ytai-btn-primary">Save</button>
            </div>
            <div class="ytai-key-status ${config.hasGeminiKey ? 'connected' : 'disconnected'}" id="ytai-key-status-gemini">
              <span class="ytai-status-dot"></span>
              <span id="ytai-key-status-text-gemini">${config.hasGeminiKey ? 'Connected' : 'Not configured'}</span>
              <span class="ytai-save-feedback" id="ytai-save-feedback-gemini">${SVG.check} Saved</span>
            </div>
            ${config.hasGeminiKey ? `<button id="ytai-settings-clear-gemini" class="ytai-btn-danger" style="margin-top:8px;width:fit-content">Remove key</button>` : ''}
          </div>
        </div>
        <div class="ytai-settings-section">
          <div class="ytai-settings-header">${SVG.globe} Transcript Language</div>
          <div class="ytai-settings-row">
            <div class="ytai-settings-desc">Preferred language for the transcript. <strong>Native</strong> = YouTube default.</div>
            <select id="ytai-transcript-lang" class="ytai-select">${tOpts}</select>
          </div>
        </div>
        <div class="ytai-settings-section">
          <div class="ytai-settings-header">${SVG.sparkles} Summary Language</div>
          <div class="ytai-settings-row">
            <div class="ytai-settings-desc">Language for key points and AI summary. <strong>Native</strong> = follows transcript language.</div>
            <select id="ytai-summary-lang" class="ytai-select">${sOpts}</select>
            <div class="ytai-save-feedback" id="ytai-lang-feedback" style="margin-top:6px">${SVG.check} Updated — next summary will use this language</div>
          </div>
        </div>
        <div class="ytai-settings-section">
          <div class="ytai-settings-header">${SVG.skip} Sponsor Skip</div>
          <div class="ytai-settings-row">
            ${toggleRows}
            <div class="ytai-settings-desc" style="margin-top:4px">AI detects segments using Groq + Gemini review (1 call each).</div>
            ${segList}
            <button id="ytai-sponsor-redetect" class="ytai-btn-primary" style="margin-top:10px;width:fit-content">Re-detect</button>
          </div>
        </div>
      </div>`;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Render Functions
  // ───────────────────────────────────────────────────────────────────────────
  const setBodyEl = (el, html) => {
    if (el) setHTML(el, html);
  };

  const renderTranscript = (data, showTs, fmtTimeFn) => {
    if (!data?.length) return '';

    const lines = data.map(l =>
      `<div class="ytai-line" data-seek="${l.start}">` +
      (showTs ? `<div class="ytai-ts">${fmtTimeFn(l.start)}</div>` : '') +
      `<div class="ytai-txt" dir="auto">${escapeHTML(l.text)}</div></div>`
    ).join('');

    return lines;
  };

  const applySyncHighlight = (idx, bodyEl, userScrolled) => {
    if (!bodyEl) return;

    bodyEl.querySelectorAll('.ytai-line.active-sync,.ytai-line.active-click')
      .forEach(l => l.classList.remove('active-sync', 'active-click'));

    if (idx < 0) return;

    const el = bodyEl.querySelectorAll('.ytai-line')[idx];
    if (!el) return;

    el.classList.add('active-sync');

    if (!userScrolled) {
      const bodyTop = bodyEl.scrollTop;
      const bodyH = bodyEl.clientHeight;
      const elTop = el.offsetTop;
      const elH = el.offsetHeight;

      if (!(elTop >= bodyTop && (elTop + elH) <= (bodyTop + bodyH))) {
        bodyEl.scrollTo({ top: elTop - bodyH / 2 + elH / 2, behavior: 'smooth' });
      }
    }
  };

  // BUG-16: Final safety-net sanitization for summary display
  const sanitizeSummary = (text) => {
    if (!text || typeof text !== 'string') return '';
    let s = text;
    s = s.replace(/^\s*\],?\s*/m, '');
    s = s.replace(/^\s*"summary"\s*[:\{]?\s*/im, '');
    s = s.replace(/^\s*"keypoints"\s*[:\[]?\s*/im, '');
    s = s.replace(/^\s*[,\{\[]\s*/m, '');
    s = s.replace(/\s*[,\}\]]\s*$/m, '');
    s = s.replace(/```[a-z]*\n?/gi, '');
    s = s.replace(/```\s*$/g, '');
    s = s.replace(/^\s*[•\-\*]\s*/gm, '');
    s = s.replace(/^\s*:\s*/, '');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.replace(/\s{2,}/g, ' ');
    return s.trim();
  };

  const paintSummary = (j, modelName = '') => {
    let rawSummary = j?.summary || j?.riassunto || j?.sintesi || '';
    let rawKeypoints = Array.isArray(j?.keypoints)
      ? j.keypoints
      : Array.isArray(j?.key_points)
        ? j.key_points
        : Array.isArray(j?.punti_chiave)
          ? j.punti_chiave
          : [];

    // Sanitize keypoints: filter JSON artifacts and clean individual entries
    let keypoints = sanitizeKeypoints(rawKeypoints);

    // Recover summary from keypoints if summary is empty but a long keypoint exists
    if (!rawSummary || rawSummary.trim().length < 20) {
      const longIdx = keypoints.findIndex(p => p.split(/\s+/).length > 50);
      if (longIdx !== -1) {
        rawSummary = keypoints.splice(longIdx, 1)[0];
      }
    }

    const summary = sanitizeSummary(rawSummary);

    const badge = modelName
      ? `<div style="font-size:11px;color:#aaa;margin-bottom:12px;padding:6px 10px;background:rgba(255,255,255,.05);border-radius:6px;font-family:monospace">Model: <strong style="color:${C.accent}">${escapeHTML(modelName)}</strong></div>`
      : '';

    return `
      <div class="ytai-summary">
        ${badge}
        <div class="ytai-section">${SVG.sparkles} Key Points</div>
        <ul>${keypoints.map(p => `<li>${bold(escapeHTML(p))}</li>`).join('')}</ul>
        <div class="ytai-section">${SVG.lines} Summary</div>
        <p>${bold(escapeHTML(summary))}</p>
      </div>`;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Text Formatting
  // ───────────────────────────────────────────────────────────────────────────
  const bold = (t) => {
    // First handle **bold** (must come before *italic* to avoid conflict)
    let s = (t || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Then handle *italic* - Safari-compatible version (no lookbehind)
    // Match *text* where text doesn't start/end with space/* and isn't surrounded by alphanumerics
    s = s.replace(/(^|[\s(])\*([^\s*'][^*']{1,}[^\s*'])\*(?![a-zA-Z0-9'])/g, '$1<em>$2</em>');
    return s;
  };

  const toPlainText = (str) => {
    return (str || '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const toCleanMd = (str) => {
    return (str || '')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const toCleanMdParagraph = (str) => {
    return (str || '')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '\n\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Event Binding Helpers
  // ───────────────────────────────────────────────────────────────────────────
  const bindSetup = (wrapper, callbacks) => {
    const { onSaveGroq, onSaveGemini } = callbacks;  // BUG-15 fix: removed onSave from destructuring
    const groqInp = wrapper.querySelector('#ytai-key-groq');
    const geminiInp = wrapper.querySelector('#ytai-key-gemini');
    const saveBtn = wrapper.querySelector('#ytai-save');

    const save = () => {
      const groqKey = groqInp?.value?.trim() || '';
      const geminiKey = geminiInp?.value?.trim() || '';

      // BUG-15 fix: always use specific callbacks, removed legacy onSave branch
      if (groqKey && onSaveGroq) onSaveGroq(groqKey);
      if (geminiKey && onSaveGemini) onSaveGemini(geminiKey);
    };

    if (saveBtn) {
      saveBtn.onclick = save;
    }

    [groqInp, geminiInp].forEach(inp => {
      if (inp) {
        inp.onkeydown = (e) => {
          if (e.key === 'Enter') save();
        };
      }
    });
  };

  const bindMain = (wrapper, callbacks) => {
    const {
      onTabSwitch,
      onTimestampToggle,
      onCopy,
      onDownload,
      onSettings,
      onSeek,
      onScroll,
    } = callbacks;

    // Tab switching
    wrapper.querySelectorAll('.ytai-tab').forEach(t => {
      t.onclick = () => {
        onTabSwitch(t.dataset.tab);
        wrapper.querySelectorAll('.ytai-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
      };
    });

    // Timestamp toggle
    const tsBtn = wrapper.querySelector('#ytai-ts');
    if (tsBtn) {
      tsBtn.onclick = () => onTimestampToggle();
    }

    // Copy button
    const cpBtn = wrapper.querySelector('#ytai-copy');
    if (cpBtn) {
      cpBtn.onclick = () => onCopy();
    }

    // Download button
    const dlBtn = wrapper.querySelector('#ytai-dl');
    if (dlBtn) {
      dlBtn.onclick = () => onDownload();
    }

    // Settings button
    const gearBtn = wrapper.querySelector('#ytai-settings');
    if (gearBtn) {
      gearBtn.onclick = () => onSettings();
    }

    // Seek on click
    const bodyEl = wrapper.querySelector('#ytai-body');
    if (bodyEl) {
      bodyEl.addEventListener('click', (e) => {
        const line = e.target.closest('.ytai-line');
        if (!line) return;

        wrapper.querySelectorAll('.ytai-line.active-click')
          .forEach(l => l.classList.remove('active-click'));
        line.classList.add('active-click');

        const seekTime = parseFloat(line.dataset.seek || 0);
        onSeek(seekTime);
      });

      // Scroll detection
      bodyEl.addEventListener('scroll', () => {
        onScroll(true);
      }, { passive: true });
    }
  };

  const bindSettings = (wrapper, callbacks) => {
    const {
      onSaveGroqKey,
      onClearGroqKey,
      onSaveGeminiKey,
      onClearGeminiKey,
      // BUG-15 fix: removed legacy onSaveKey/onClearKey
      onTLangChange,
      onSLangChange,
      onSkipToggle,
      onRedetect,
    } = callbacks;

    // Save Groq key
    const saveGroqBtn = wrapper.querySelector('#ytai-settings-save-groq');
    const groqInp = wrapper.querySelector('#ytai-settings-key-groq');

    if (saveGroqBtn && groqInp) {
      saveGroqBtn.addEventListener('click', () => {
        const v = groqInp.value.trim();
        if (!v || v.startsWith('●')) return;
        if (onSaveGroqKey) onSaveGroqKey(v);
        // BUG-15 fix: removed else if (onSaveKey) fallback
      });

      groqInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = e.currentTarget.value.trim();
          if (v && !v.startsWith('●')) {
            if (onSaveGroqKey) onSaveGroqKey(v);
            // BUG-15 fix: removed else if (onSaveKey) fallback
          }
        }
        if (e.currentTarget.value.startsWith('●')) e.currentTarget.value = '';
      });

      groqInp.addEventListener('focus', (e) => {
        if (e.target.value.startsWith('●')) e.target.value = '';
      });
    }

    // Clear Groq key
    const clearGroqBtn = wrapper.querySelector('#ytai-settings-clear-groq');
    if (clearGroqBtn) {
      clearGroqBtn.addEventListener('click', () => {
        if (onClearGroqKey) onClearGroqKey();
        // BUG-15 fix: removed else if (onClearKey) fallback
      });
    }

    // Save Gemini key
    const saveGeminiBtn = wrapper.querySelector('#ytai-settings-save-gemini');
    const geminiInp = wrapper.querySelector('#ytai-settings-key-gemini');

    if (saveGeminiBtn && geminiInp) {
      saveGeminiBtn.addEventListener('click', () => {
        const v = geminiInp.value.trim();
        if (!v || v.startsWith('●')) return;
        if (onSaveGeminiKey) onSaveGeminiKey(v);
      });

      geminiInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = e.currentTarget.value.trim();
          if (v && !v.startsWith('●') && onSaveGeminiKey) onSaveGeminiKey(v);
        }
        if (e.currentTarget.value.startsWith('●')) e.currentTarget.value = '';
      });

      geminiInp.addEventListener('focus', (e) => {
        if (e.target.value.startsWith('●')) e.target.value = '';
      });
    }

    // Clear Gemini key
    const clearGeminiBtn = wrapper.querySelector('#ytai-settings-clear-gemini');
    if (clearGeminiBtn) {
      clearGeminiBtn.addEventListener('click', () => {
        if (onClearGeminiKey) onClearGeminiKey();
      });
    }

    // Language selectors
    const tLangSel = wrapper.querySelector('#ytai-transcript-lang');
    if (tLangSel) {
      tLangSel.addEventListener('change', (e) => onTLangChange(e.target.value));
    }

    const sLangSel = wrapper.querySelector('#ytai-summary-lang');
    if (sLangSel) {
      sLangSel.addEventListener('change', (e) => onSLangChange(e.target.value));
    }

    // Skip type toggles
    wrapper.querySelectorAll('input[data-skip-type]').forEach(el => {
      el.addEventListener('change', (ev) => {
        onSkipToggle(ev.target.dataset.skipType, ev.target.checked);
      });
    });

    // Re-detect sponsors
    const redetectBtn = wrapper.querySelector('#ytai-sponsor-redetect');
    if (redetectBtn) {
      redetectBtn.addEventListener('click', onRedetect);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // UI Utilities
  // ───────────────────────────────────────────────────────────────────────────
  const updateToolbar = (wrapper, tab, showTs) => {
    const tsBtn = wrapper.querySelector('#ytai-ts');
    const cpBtn = wrapper.querySelector('#ytai-copy');
    const dlBtn = wrapper.querySelector('#ytai-dl');
    const dlLbl = wrapper.querySelector('#ytai-dl-lbl');
    const gearBtn = wrapper.querySelector('#ytai-settings');

    if (!tsBtn) return;

    const isAI = tab === 'ai';
    const isConf = tab === 'settings';

    tsBtn.hidden = isAI || isConf;
    if (cpBtn) cpBtn.hidden = isConf;
    if (dlBtn) dlBtn.hidden = isConf;
    if (gearBtn) gearBtn.classList.toggle('on', isConf);
    if (dlLbl) dlLbl.textContent = isAI ? 'Export .md' : 'Download';
  };

  const flash = (wrapper, btnSel, lblSel, onText, offText) => {
    const btn = wrapper?.querySelector(btnSel);
    const lbl = wrapper?.querySelector(lblSel);
    if (!btn || !lbl) return;

    btn.classList.add('ok');
    lbl.textContent = onText;
    setTimeout(() => {
      btn.classList.remove('ok');
      lbl.textContent = offText;
    }, 2000);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.UI = {
    // HTML generators
    htmlSetup,
    htmlMain,
    htmlSettings,
    htmlGeminiMissing,
    // Render
    setBodyEl,
    renderTranscript,
    applySyncHighlight,
    paintSummary,
    updateToolbar,
    flash,
    // Binding
    bindSetup,
    bindMain,
    bindSettings,
    // Formatting
    fmtTime,
    bold,
    toPlainText,
    toCleanMd,
    toCleanMdParagraph,
  };
})();
