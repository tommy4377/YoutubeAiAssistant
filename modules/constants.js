// constants.js - YouTube AI Assistant v5.0 - Constants and Utilities Module
(function () {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────────
  // Trusted Types Policy (CSP bypass for innerHTML)
  // ───────────────────────────────────────────────────────────────────────────
  let ttPolicy = null;
  try {
    if (window.trustedTypes?.createPolicy) {
      ttPolicy = window.trustedTypes.createPolicy('yt-ai', { createHTML: s => s });
    }
  } catch (_) { /* ignore */ }

  const setHTML = (el, html) => {
    try {
      el.innerHTML = ttPolicy ? ttPolicy.createHTML(html) : html;
    } catch (_) {
      el.innerHTML = html;
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Global References
  // ───────────────────────────────────────────────────────────────────────────
  const doc = typeof unsafeWindow !== 'undefined' ? unsafeWindow.document : document;
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ───────────────────────────────────────────────────────────────────────────
  // API Configuration
  // ───────────────────────────────────────────────────────────────────────────
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';  // OPT-01: using gemini-2.0-flash (stable)
  const GEMINI_MODEL = 'gemini-2.5-flash';

  const selectGroqModel = (len) => {
    if (len <= 11000) return 'llama-3.1-8b-instant';
    if (len <= 26000) return 'llama-3.3-70b-versatile';
    return 'openai/gpt-oss-120b'; // Production model (was llama-4-scout Preview)
  };

  // Dedicated cheap model for sponsor detection (sufficient for classification)
  const SPONSOR_MODEL = 'llama-3.1-8b-instant';

  // ───────────────────────────────────────────────────────────────────────────
  // Storage Keys
  // ───────────────────────────────────────────────────────────────────────────
  const WIDGET_ID = 'yt-ai-assistant-widget';
  const KEY_API = 'groq_api_key';
  const KEY_GEMINI_API = 'gemini_api_key';
  const KEY_T_LANG = 'transcript_lang';
  const KEY_S_LANG = 'summary_lang';
  const KEY_CACHE = 'summary_cache_v3'; // Bumped to v3 for Gemini-reviewed results
  const KEY_SPONSOR_CACHE = 'sponsor_cache_v2'; // Bumped to v2 for Gemini-reviewed segments
  const SPONSOR_CACHE_MAX = 50;
  const CACHE_MAX = 30;
  const FOOTER = 'YouTube AI Assistant by tommy437';

  // ───────────────────────────────────────────────────────────────────────────
  // Segment Types
  // ───────────────────────────────────────────────────────────────────────────
  const SEG_TYPE_SPONSOR = 'sponsor';
  const SEG_TYPE_SELF_PROMO = 'self_promo';
  const SEG_TYPE_ENGAGEMENT = 'engagement';

  const SEG_COLORS = {
    [SEG_TYPE_SPONSOR]: '#ffb74d',
    [SEG_TYPE_SELF_PROMO]: '#ce93d8',
    [SEG_TYPE_ENGAGEMENT]: '#4fc3f7',
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Language Configuration
  // ───────────────────────────────────────────────────────────────────────────
  const LANGUAGES = [
    { value: 'native', label: 'Native (auto)', aiName: null, yt_text: null },
    { value: 'en', label: 'English', aiName: 'English', yt_text: 'English' },
    { value: 'it', label: 'Italian', aiName: 'Italian', yt_text: 'Italiano' },
    { value: 'fr', label: 'French', aiName: 'French', yt_text: 'Français' },
    { value: 'es', label: 'Spanish', aiName: 'Spanish', yt_text: 'Español' },
    { value: 'de', label: 'German', aiName: 'German', yt_text: 'Deutsch' },
    { value: 'pt', label: 'Portuguese', aiName: 'Portuguese', yt_text: 'Português' },
    { value: 'ja', label: 'Japanese', aiName: 'Japanese', yt_text: '日本語' },
    { value: 'zh', label: 'Chinese', aiName: 'Chinese', yt_text: '中文' },
    { value: 'ru', label: 'Russian', aiName: 'Russian', yt_text: 'Русский' },
    { value: 'ar', label: 'Arabic', aiName: 'Arabic', yt_text: 'العربية' },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Color Theme
  // ───────────────────────────────────────────────────────────────────────────
  const C = {
    bgCard: '#212121',
    bgHeader: '#181818',
    bgInput: '#0f0f0f',
    bgHover: 'rgba(255,255,255,0.1)',
    bgActive: 'rgba(255,255,255,0.12)',
    text: '#f1f1f1',
    textSoft: '#e0e0e0',
    muted: '#aaaaaa',
    borderSoft: 'rgba(255,255,255,0.1)',
    accent: '#3ea6ff',
    error: '#ff5252',
    success: '#4caf50',
    warning: '#ffb74d',
  };

  // ───────────────────────────────────────────────────────────────────────────
  // SVG Icons
  // ───────────────────────────────────────────────────────────────────────────
  const SVG = {
    bulb: '<svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" style="opacity:.4"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>',
    lines: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    time: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>',
  };

  // ───────────────────────────────────────────────────────────────────────────
  // String Utilities
  // ───────────────────────────────────────────────────────────────────────────
  const escapeHTML = (s) => (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const sanitizeKeypoint = (text) => {
    if (typeof text !== 'string') return '';
    let s = text;
    // Collapse newlines (multi-line artifacts from broken JSON)
    s = s.replace(/[\r\n]+/g, ' ');
    // Remove JSON quote artifacts: comma/bracket + quote before capitalized word
    s = s.replace(/([,\]])\s*"\s+(?=[A-ZÀ-Ÿ])/g, '$1 ');
    // Remove leading JSON quote before capitalized word
    s = s.replace(/^"\s*(?=[A-ZÀ-Ÿ])/i, '');
    // Strip trailing JSON structural characters: ], }, "
    s = s.replace(/\s*[\]\}"]+\s*$/, '');
    // Strip trailing comma
    s = s.replace(/,\s*$/, '');
    // Normalize whitespace
    s = s.replace(/\s{2,}/g, ' ');
    return s.trim();
  };

  const JSON_TOKENS = new Set([
    'summary', 'keypoints', 'key_points', 'punti_chiave', 'points',
    ':', ',', 'null', 'true', 'false', '[]', '{}', ']', '[', '}', '{',
  ]);

  const sanitizeKeypoints = (points) => {
    if (!Array.isArray(points)) return [];
    return points
      .map(p => sanitizeKeypoint(typeof p === 'string' ? p : String(p)))
      .filter(p => p.length > 0 && !JSON_TOKENS.has(p.toLowerCase()) && !/^[\[\]\{\}:,."'`\s]+$/.test(p));
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Shadow DOM Helpers
  // ───────────────────────────────────────────────────────────────────────────
  const querySelectorShadow = (root, selector, depth = 0) => {
    if (!root || typeof root.querySelector !== 'function' || depth > 8) return null;
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch (_) { /* ignore */ }
    for (const child of root.children || []) {
      if (child.shadowRoot) {
        const found = querySelectorShadow(child.shadowRoot, selector, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  const findSidebar = () => {
    const watchApp = doc.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (!watchApp) return null;
    return watchApp.querySelector('#secondary-inner, #secondary') ||
      querySelectorShadow(watchApp, '#secondary-inner, #secondary') ||
      (() => {
        const r = watchApp.querySelector('ytd-watch-next-secondary-results-renderer') ||
          querySelectorShadow(watchApp, 'ytd-watch-next-secondary-results-renderer');
        return r?.parentElement || null;
      })();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports to Global Namespace
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};

  // Constants
  window.YTAI.CONSTANTS = {
    GROQ_URL,
    GEMINI_URL,
    GEMINI_MODEL,
    SPONSOR_MODEL,
    WIDGET_ID,
    KEY_API,
    KEY_GEMINI_API,
    KEY_T_LANG,
    KEY_S_LANG,
    KEY_CACHE,
    KEY_SPONSOR_CACHE,
    SPONSOR_CACHE_MAX,
    CACHE_MAX,
    FOOTER,
    SEG_TYPE_SPONSOR,
    SEG_TYPE_SELF_PROMO,
    SEG_TYPE_ENGAGEMENT,
    SEG_COLORS,
    LANGUAGES,
    C,
    SVG,
  };

  // Utilities
  window.YTAI.UTILS = {
    doc,
    win,
    escapeHTML,
    setHTML,
    selectGroqModel,
    querySelectorShadow,
    findSidebar,
    sanitizeKeypoint,
    sanitizeKeypoints,
  };
})();
