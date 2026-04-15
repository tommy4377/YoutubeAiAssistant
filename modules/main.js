// main.js - YouTube AI Assistant v5.0 - Main Application Module
(function () {
  'use strict';

  // Ensure all dependencies are loaded
  const {
    CONSTANTS,
    UTILS,
    STYLES,
    TRANSCRIPT,
    GROQ,
    SPONSOR,
    UI,
  } = window.YTAI || {};

  if (!CONSTANTS || !UTILS || !STYLES || !TRANSCRIPT || !GROQ || !SPONSOR || !UI) {
    console.error('[YTAI Main] Dependencies missing. Check that all modules are @required in the correct order.');
    return;
  }

  const {
    WIDGET_ID,
    KEY_API,
    KEY_T_LANG,
    KEY_S_LANG,
    KEY_CACHE,
    CACHE_MAX,
    SEG_TYPE_SPONSOR,
    SEG_TYPE_SELF_PROMO,
    SEG_TYPE_ENGAGEMENT,
  } = CONSTANTS;

  const { doc, win, findSidebar, setHTML } = UTILS;

  // ───────────────────────────────────────────────────────────────────────────
  // YTAIApp Class
  // ───────────────────────────────────────────────────────────────────────────
  class YTAIApp {
    constructor() {
      // Tab state
      this.tab = 'transcript';
      this._prevTab = 'transcript';

      // Data
      this.data = [];
      this.videoId = null;
      this._fetchMethod = '';

      // UI state
      this.showTs = true;
      this._wrapper = null;

      // Sync state
      this._syncRaf = null;
      this._syncActive = -1;
      this._userScrolled = false;
      this._scrollTimer = null;

      // Lifecycle
      this._isIniting = false;

      // Cache
      this._cache = this._loadCache();

      // Sponsor detection
      this._sponsorSegments = [];
      this._skipperAttached = false;
      this._skipListener = null;
      this._seekbarObserver = null;

      // Inject styles
      STYLES.inject();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────────────────
    _loadCache() {
      try {
        return JSON.parse(GM_getValue(KEY_CACHE, '{}'));
      } catch {
        return {};
      }
    }

    _saveCache() {
      const dataKeys = Object.keys(this._cache).filter(k => !k.endsWith('__model'));
      if (dataKeys.length > CACHE_MAX) {
        dataKeys.slice(0, dataKeys.length - CACHE_MAX).forEach(k => {
          delete this._cache[k];
          delete this._cache[k + '__model'];
        });
      }
      try {
        GM_setValue(KEY_CACHE, JSON.stringify(this._cache));
      } catch (_) { /* ignore */ }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settings
    // ─────────────────────────────────────────────────────────────────────────
    _hasKey() {
      return GM_getValue(KEY_API, '').trim().length > 0;
    }

    _getTLang() {
      return win.localStorage.getItem(KEY_T_LANG) ?? 'native';
    }

    _getSLang() {
      return win.localStorage.getItem(KEY_S_LANG) ?? 'native';
    }

    async _setTLang(v) {
      win.localStorage.setItem(KEY_T_LANG, v);
      return Promise.resolve();
    }

    _setSLang(v) {
      win.localStorage.setItem(KEY_S_LANG, v);
    }

    _cacheKey() {
      return `${this.videoId}||${this._getSLang()}`;
    }

    // Skip type toggles
    _getSkipType(type) {
      return GM_getValue(`skip_${type}`, true);
    }

    _setSkipType(type, val) {
      GM_setValue(`skip_${type}`, val);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────────────────
    async init() {
      if (this._isIniting) return;
      this._isIniting = true;

      try {
        this.videoId = new URLSearchParams(location.search).get('v');
        if (!this.videoId) return;

        // Cleanup previous state
        this._stopSync();
        doc.getElementById(WIDGET_ID)?.remove();
        this.data = [];
        this._wrapper = null;
        this._syncActive = -1;
        this._userScrolled = false;
        this._fetchMethod = '';
        this._sponsorSegments = [];
        this._detachSkipper();
        this._detachSeekbarObserver();

        // Wait for sidebar
        const sidebar = await this._waitFor(() => findSidebar(), 10000);
        if (!sidebar) return;

        // Build UI
        this._buildUI(sidebar);

        // Fetch transcript if key exists
        if (this._hasKey()) {
          await this._fetchTranscript();
        }
      } finally {
        setTimeout(() => { this._isIniting = false; }, 1200);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Data Reading
    // ─────────────────────────────────────────────────────────────────────────
    _readTitle() {
      return doc.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() ||
        doc.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.textContent?.trim() ||
        doc.title?.replace(/ ?[-–|] ?YouTube$/, '').trim() ||
        this.videoId;
    }

    _readChannel() {
      return doc.querySelector('ytd-channel-name a')?.textContent?.trim() ||
        doc.querySelector('.ytd-channel-name a')?.textContent?.trim() ||
        'the speaker';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Generic Wait Helper
    // ─────────────────────────────────────────────────────────────────────────
    _waitFor(fn, timeout = 8000) {
      return new Promise((resolve) => {
        const el = fn();
        if (el) return resolve(el);

        let tid, toid;
        const obs = new MutationObserver(() => {
          const r = fn();
          if (r) {
            clear();
            resolve(r);
          }
        });

        const clear = () => {
          clearInterval(tid);
          clearTimeout(toid);
          obs.disconnect();
        };

        tid = setInterval(() => {
          const r = fn();
          if (r) {
            clear();
            resolve(r);
          }
        }, 300);

        toid = setTimeout(() => {
          clear();
          resolve(fn() || null);
        }, timeout);

        try {
          obs.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
        } catch (_) { /* ignore */ }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UI Building
    // ─────────────────────────────────────────────────────────────────────────
    _buildUI(sidebar) {
      const w = doc.createElement('div');
      w.id = WIDGET_ID;
      this._wrapper = w;

      setHTML(w, this._hasKey()
        ? UI.htmlMain(this.tab, this.showTs)
        : UI.htmlSetup(this._hasKey()));

      sidebar.insertBefore(w, sidebar.firstChild);

      if (this._hasKey()) {
        this._bindMain();
      } else {
        this._bindSetup();
      }
    }

    _bindSetup() {
      UI.bindSetup(this._wrapper, {
        onSave: (key) => {
          GM_setValue(KEY_API, key);
          this.init();
        },
      });
    }

    _bindMain() {
      UI.bindMain(this._wrapper, {
        onTabSwitch: (tab) => {
          this._prevTab = this.tab;
          this.tab = tab;
          this._renderTab();
        },
        onTimestampToggle: () => {
          this.showTs = !this.showTs;
          const tsBtn = this._wrapper.querySelector('#ytai-ts');
          if (tsBtn) tsBtn.classList.toggle('on', this.showTs);
          if (this.tab === 'transcript') {
            this._renderTranscript();
          }
        },
        onCopy: () => {
          const text = this.tab === 'ai'
            ? this._summaryPlainText()
            : this._transcriptText();
          if (!text) return;
          win.navigator.clipboard.writeText(text).catch(() => { });
          UI.flash(this._wrapper, '#ytai-copy', '#ytai-copy-lbl', 'Copied ✓', 'Copy');
        },
        onDownload: () => {
          if (this.tab === 'ai') {
            if (!this._cache[this._cacheKey()]) return;
            this._downloadSummary();
            UI.flash(this._wrapper, '#ytai-dl', '#ytai-dl-lbl', 'Saved ✓', 'Export .md');
          } else {
            if (!this.data.length) return;
            this._downloadTranscript();
            UI.flash(this._wrapper, '#ytai-dl', '#ytai-dl-lbl', 'Saved ✓', 'Download');
          }
        },
        onSettings: () => {
          if (this.tab === 'settings') {
            this.tab = this._prevTab || 'transcript';
            this._renderTab();
          } else {
            this._prevTab = this.tab;
            this.tab = 'settings';
            this._renderTab();
          }
        },
        onSeek: (time) => {
          const video = doc.querySelector('video');
          if (video) video.currentTime = time;
          this._userScrolled = false;
        },
        onScroll: () => {
          this._userScrolled = true;
          clearTimeout(this._scrollTimer);
          this._scrollTimer = setTimeout(() => {
            this._userScrolled = false;
          }, 5000);
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Transcript Fetching
    // ─────────────────────────────────────────────────────────────────────────
    async _fetchTranscript() {
      this.data = [];
      this._fetchMethod = '';

      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      if (bodyEl) {
        UI.setBodyEl(bodyEl, '<div class="ytai-loading"><span>Fetching transcript…</span></div>');
      }

      try {
        const { data, method } = await TRANSCRIPT.fetchTranscript(
          this.videoId,
          this._getTLang(),
          this._waitFor.bind(this)
        );

        this.data = data;
        this._fetchMethod = method;
        this._renderTab();
        this._startSync();
        await this._detectSponsors();
      } catch (e) {
        console.error('[YT AI] All methods failed:', e.message);
        if (bodyEl) {
          UI.setBodyEl(bodyEl, `
            <div class="ytai-error">
              Transcript not available.<br>
              <small>Make sure the video has captions (CC) enabled.</small><br><br>
              <small>${CONSTANTS.escapeHTML(e.message)}</small>
            </div>
          `);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sponsor Detection
    // ─────────────────────────────────────────────────────────────────────────
    async _detectSponsors() {
      const apiKey = GM_getValue(KEY_API, '');
      if (!apiKey) return;

      try {
        const segments = await SPONSOR.detectSponsors(this.videoId, this.data, apiKey);
        this._sponsorSegments = segments;

        if (segments.length > 0) {
          this._attachSkipper();
          this._paintSeekbarSegments();
        }

        if (this.tab === 'settings') {
          this._renderSettings();
        }
      } catch (e) {
        console.warn('[YT AI] Sponsor detection failed:', e);
      }
    }

    _attachSkipper() {
      if (this._skipperAttached) return;
      const video = doc.querySelector('video');
      if (!video) return;

      this._skipListener = SPONSOR.attachSkipper(
        video,
        this._sponsorSegments,
        (type) => this._getSkipType(type)
      );
      this._skipperAttached = true;
    }

    _detachSkipper() {
      if (!this._skipperAttached) return;
      const video = doc.querySelector('video');
      SPONSOR.detachSkipper(video, this._skipListener);
      this._skipListener = null;
      this._skipperAttached = false;
    }

    _paintSeekbarSegments() {
      const video = doc.querySelector('video');
      if (!video?.duration) {
        setTimeout(() => this._paintSeekbarSegments(), 1500);
        return;
      }

      this._seekbarObserver = SPONSOR.paintSeekbarSegments(
        this._sponsorSegments,
        video.duration,
        UI.fmtTime
      );
    }

    _detachSeekbarObserver() {
      if (this._seekbarObserver) {
        SPONSOR.detachSeekbarObserver(this._seekbarObserver);
        this._seekbarObserver = null;
      }
      SPONSOR.removeSeekbarOverlay();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Live Sync
    // ─────────────────────────────────────────────────────────────────────────
    _startSync() {
      this._stopSync();
      this._syncActive = -1;

      const loop = () => {
        if (this.tab === 'transcript') {
          const video = doc.querySelector('video');
          const body = doc.getElementById('ytai-body');
          if (video && body && this.data.length) {
            const idx = this._findActiveIndex(video.currentTime);
            if (idx !== this._syncActive) {
              this._syncActive = idx;
              UI.applySyncHighlight(idx, body, this._userScrolled);
            }
          }
        }
        this._syncRaf = requestAnimationFrame(loop);
      };

      this._syncRaf = requestAnimationFrame(loop);
    }

    _stopSync() {
      if (this._syncRaf !== null) {
        cancelAnimationFrame(this._syncRaf);
        this._syncRaf = null;
      }
    }

    _findActiveIndex(ct) {
      const d = this.data;
      let lo = 0, hi = d.length - 1, res = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid].start <= ct) {
          res = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return res;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tab Rendering
    // ─────────────────────────────────────────────────────────────────────────
    _renderTab() {
      UI.updateToolbar(this._wrapper, this.tab, this.showTs);

      if (this.tab === 'transcript') {
        this._startSync();
        this._renderTranscript();
      } else {
        this._stopSync();
        if (this.tab === 'ai') {
          this._renderSummary();
        } else if (this.tab === 'settings') {
          this._renderSettings();
        }
      }
    }

    _renderTranscript() {
      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      if (!bodyEl || !this.data.length) return;

      const html = UI.renderTranscript(this.data, this.showTs, UI.fmtTime);
      UI.setBodyEl(bodyEl, html);

      if (this._syncActive >= 0) {
        UI.applySyncHighlight(this._syncActive, bodyEl, this._userScrolled);
      }
    }

    _renderSummary() {
      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      if (!bodyEl) return;

      if (!this.data.length) {
        UI.setBodyEl(bodyEl, '<div class="ytai-error">Load the transcript first.</div>');
        return;
      }

      const ck = this._cacheKey();
      if (this._cache[ck]) {
        const html = UI.paintSummary(this._cache[ck], this._cache[ck + '__model']);
        UI.setBodyEl(bodyEl, html);
        return;
      }

      this._callGroq();
    }

    _renderSettings() {
      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      if (!bodyEl) return;

      const masked = this._hasKey()
        ? '●●●●●●●●' + GM_getValue(KEY_API, '').slice(-4)
        : '';

      const html = UI.htmlSettings({
        tl: this._getTLang(),
        sl: this._getSLang(),
        hasKey: this._hasKey(),
        masked,
        sponsorSegments: this._sponsorSegments,
        skipTypeGetter: (type) => this._getSkipType(type),
        fmtTime: UI.fmtTime,
      });

      UI.setBodyEl(bodyEl, `<div style="padding:0">${html}</div>`);
      setTimeout(() => this._bindSettings(), 0);
    }

    _bindSettings() {
      UI.bindSettings(this._wrapper, {
        onSaveKey: (key) => {
          GM_setValue(KEY_API, key);
          const inp = this._wrapper.querySelector('#ytai-settings-key');
          const statusEl = this._wrapper.querySelector('#ytai-key-status');
          const statusText = this._wrapper.querySelector('#ytai-key-status-text');
          const feedback = this._wrapper.querySelector('#ytai-save-feedback');

          if (inp) inp.value = '●●●●●●●●' + key.slice(-4);
          if (statusEl) statusEl.className = 'ytai-key-status connected';
          if (statusText) statusText.textContent = 'Connected';
          if (feedback) {
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2500);
          }
        },
        onClearKey: () => {
          GM_setValue(KEY_API, '');
          this.init();
        },
        onTLangChange: async (value) => {
          await this._setTLang(value);
          this.data = [];
          await Promise.resolve(); // Ensure localStorage flush
          this._fetchTranscript();
        },
        onSLangChange: (value) => {
          this._setSLang(value);
          delete this._cache[this._cacheKey()];
          delete this._cache[this._cacheKey() + '__model'];
          const fb = this._wrapper.querySelector('#ytai-lang-feedback');
          if (fb) {
            fb.classList.add('show');
            setTimeout(() => fb.classList.remove('show'), 3000);
          }
        },
        onSkipToggle: (type, checked) => {
          this._setSkipType(type, checked);
        },
        onRedetect: () => {
          if (!this.videoId) return;
          const c = SPONSOR.loadCache();
          delete c[this.videoId];
          SPONSOR.saveCache(c);
          this._sponsorSegments = [];
          this._detachSkipper();
          this._detachSeekbarObserver();
          this._detectSponsors();
          this._renderSettings();
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AI Summary
    // ─────────────────────────────────────────────────────────────────────────
    async _callGroq() {
      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      const setBody = (html) => UI.setBodyEl(bodyEl, html);

      try {
        const transcriptText = this.data.map(l => l.text).join(' ').substring(0, 90000);
        const result = await GROQ.callSummaryWithUI(
          GM_getValue(KEY_API),
          transcriptText,
          this._readChannel(),
          this._getSLang(),
          setBody
        );

        if (!result) return; // Retry in progress

        const ck = this._cacheKey();
        this._cache[ck] = {
          keypoints: result.keypoints,
          summary: result.summary,
        };
        this._cache[ck + '__model'] = result.model;
        this._saveCache();

        UI.setBodyEl(bodyEl, UI.paintSummary(result, result.model));
      } catch (e) {
        console.error('[YT AI]', e);
        UI.setBodyEl(bodyEl, `<div class="ytai-error">AI error: ${CONSTANTS.escapeHTML(e.message)}</div>`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Text Builders
    // ─────────────────────────────────────────────────────────────────────────
    _transcriptText() {
      if (!this.data.length) return '';
      return this.data.map(l =>
        (this.showTs ? `[${UI.fmtTime(l.start)}] ` : '') + l.text
      ).join('\n') + `\n\n---\n${CONSTANTS.FOOTER}`;
    }

    _summaryPlainText() {
      const j = this._cache[this._cacheKey()];
      if (!j) return '';

      const normalized = {
        keypoints: Array.isArray(j?.keypoints)
          ? j.keypoints
          : Array.isArray(j?.key_points)
            ? j.key_points
            : Array.isArray(j?.punti_chiave)
              ? j.punti_chiave
              : [],
        summary: j?.summary || j?.riassunto || j?.sintesi || '',
      };

      const points = normalized.keypoints.map(p => `• ${UI.toPlainText(p)}`).join('\n');
      const summary = UI.toPlainText(normalized.summary);

      return `KEY POINTS\n\n${points}\n\nSUMMARY\n\n${summary}\n\n---\n${CONSTANTS.FOOTER}`;
    }

    _summaryMarkdown() {
      const j = this._cache[this._cacheKey()];
      if (!j) return '';

      const normalized = {
        keypoints: Array.isArray(j?.keypoints)
          ? j.keypoints
          : Array.isArray(j?.key_points)
            ? j.key_points
            : Array.isArray(j?.punti_chiave)
              ? j.punti_chiave
              : [],
        summary: j?.summary || j?.riassunto || j?.sintesi || '',
      };

      const title = this._readTitle() || this.videoId;
      const date = new Date().toISOString().slice(0, 10);
      const points = normalized.keypoints.map(p => `- ${UI.toCleanMd(p)}`).join('\n');
      const summary = UI.toCleanMdParagraph(normalized.summary);

      return `# ${title}\n\n> Generated on ${date}\n\n## Key Points\n\n${points}\n\n## Summary\n\n${summary}\n\n---\n*${CONSTANTS.FOOTER}*\n`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // File Download
    // ─────────────────────────────────────────────────────────────────────────
    _safeFilename(t) {
      return (t || this.videoId)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, '_')
        .trim()
        .substring(0, 100) || this.videoId;
    }

    _downloadTranscript() {
      this._dl(this._transcriptText(), `${this._safeFilename(this._readTitle())}.txt`, 'text/plain');
    }

    _downloadSummary() {
      this._dl(this._summaryMarkdown(), `${this._safeFilename(this._readTitle())}_summary.md`, 'text/markdown');
    }

    _dl(content, filename, mime) {
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const a = Object.assign(doc.createElement('a'), {
        href: win.URL.createObjectURL(blob),
        download: filename,
      });
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(() => win.URL.revokeObjectURL(a.href), 3000);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bootstrap
  // ───────────────────────────────────────────────────────────────────────────
  const app = new YTAIApp();
  let lastPath = '';

  function run() {
    if (location.pathname !== '/watch') {
      doc.getElementById(WIDGET_ID)?.remove();
      return;
    }

    const cur = location.pathname + location.search;
    if (cur !== lastPath) {
      lastPath = cur;
      app.init();
      return;
    }

    const sidebar = findSidebar();
    if (sidebar && !doc.getElementById(WIDGET_ID)) {
      if (app._wrapper && app.data.length > 0) {
        sidebar.insertBefore(app._wrapper, sidebar.firstChild);
        if (app.tab === 'transcript') app._startSync();
      } else {
        app.init();
      }
    }
  }

  setInterval(run, 1500);
  doc.readyState !== 'loading' ? run() : doc.addEventListener('DOMContentLoaded', run);
  doc.addEventListener('yt-navigate-finish', run);

  // Log initialization
  console.log('[YT AI] YouTube Transcript & AI Assistant v5.0 (Modular) initialized');
})();
