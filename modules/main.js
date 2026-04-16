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
    GEMINI,
    SPONSOR,
    UI,
  } = window.YTAI || {};

  if (!CONSTANTS || !UTILS || !STYLES || !TRANSCRIPT || !GROQ || !GEMINI || !SPONSOR || !UI) {
    console.error('[YTAI Main] Dependencies missing. Check that all modules are @required in the correct order.');
    return;
  }

  const {
    WIDGET_ID,
    KEY_API,
    KEY_GEMINI_API,
    KEY_T_LANG,
    KEY_S_LANG,
    KEY_CACHE,
    CACHE_MAX,
    SEG_TYPE_SPONSOR,
    SEG_TYPE_SELF_PROMO,
    SEG_TYPE_ENGAGEMENT,
  } = CONSTANTS;

  const { doc, win, findSidebar, setHTML, escapeHTML, sanitizeKeypoints } = UTILS;

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

      // Fetch generation counters (to cancel stale results)
      this._fetchGen = 0;
      this._aiGen = 0;
      this._sponsorGen = 0;  // BUG-12: sponsor generation counter

      // Cache
      this._cache = this._loadCache();

      // Sponsor detection
      this._sponsorSegments = [];
      this._skipperAttached = false;
      this._skipListener = null;
      this._videoEl = null; // Store video element reference for proper cleanup
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

    _hasGeminiKey() {
      return GM_getValue(KEY_GEMINI_API, '').trim().length > 0;  // BUG-03 fix: use constant
    }

    _getGeminiKey() {
      return GM_getValue(KEY_GEMINI_API, '');  // BUG-03 fix: use constant
    }

    _getTLang() {
      return GM_getValue(KEY_T_LANG, 'native');
    }

    _getSLang() {
      return GM_getValue(KEY_S_LANG, 'native');
    }

    _setTLang(v) {
      GM_setValue(KEY_T_LANG, v);
    }

    _setSLang(v) {
      GM_setValue(KEY_S_LANG, v);
    }

    _cacheKey() {
      return `${this.videoId}||${this._getSLang()}`;
    }

    // Skip type toggles
    _getSkipType(type) {
      return GM_getValue(`skip_${type}`, false); // Fix 3: default OFF
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
        clearTimeout(this._scrollTimer);
        this._scrollTimer = null;
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

      // Fetch transcript only if BOTH keys exist (not in setup mode)
      // BUG-14 fix: prevent transcript overwriting setup UI
      if (this._hasKey() && this._hasGeminiKey()) {
        await this._fetchTranscript();
      }
      } finally {
        this._isIniting = false;  // BUG-04 fix: reset immediately without timeout
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Data Reading (async to wait for DOM updates - BUG-17)
    // ─────────────────────────────────────────────────────────────────────────
    async _readTitle() {
      // BUG-17: Wait for title element to reflect current video
      const titleEl = await this._waitFor(() => {
        const el = doc.querySelector('h1.ytd-video-primary-info-renderer');
        if (!el) return null;
        const text = el.textContent?.trim();
        // Ensure it's not empty and not the video ID itself
        return (text && text !== this.videoId) ? el : null;
      }, 3000);

      if (titleEl) return titleEl.textContent.trim();

      // Fallbacks
      return doc.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.textContent?.trim() ||
        doc.title?.replace(/ ?[-–|] ?YouTube$/, '').trim() ||
        this.videoId;
    }

    async _readChannel() {
      // BUG-17: Wait for channel element with non-empty text
      const channelEl = await this._waitFor(() => {
        const el = doc.querySelector('ytd-channel-name a');
        if (!el) return null;
        const text = el.textContent?.trim();
        return text ? el : null;
      }, 3000);

      if (channelEl) return channelEl.textContent.trim();

      // Fallback
      return doc.querySelector('.ytd-channel-name a')?.textContent?.trim() || 'the speaker';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Generic Wait Helper
    // ─────────────────────────────────────────────────────────────────────────
    _waitFor(fn, timeout = 8000) {
      return new Promise((resolve) => {
        const el = fn();
        if (el) return resolve(el);

        let resolved = false; // Bug 12 fix: prevent double resolve
        const resolveOnce = (val) => {
          if (!resolved) {
            resolved = true;
            resolve(val);
          }
        };

        let tid, toid;
        const obs = new MutationObserver(() => {
          const r = fn();
          if (r) {
            clear();
            resolveOnce(r);
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
            resolveOnce(r);
          }
        }, 300);

        toid = setTimeout(() => {
          clear();
          resolveOnce(fn() || null);
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

      const hasGroq = this._hasKey();
      const hasGemini = this._hasGeminiKey();

      if (hasGroq && hasGemini) {
        setHTML(w, UI.htmlMain(this.tab, this.showTs, false));
        sidebar.insertBefore(w, sidebar.firstChild);
        this._bindMain();
      } else {
        setHTML(w, UI.htmlSetup(hasGroq, hasGemini));
        sidebar.insertBefore(w, sidebar.firstChild);
        this._bindSetup();
      }
    }

    _bindSetup() {
      UI.bindSetup(this._wrapper, {
        onSaveGroq: (key) => {
          GM_setValue(KEY_API, key);
          // Only init if both keys are now present
          if (this._hasGeminiKey()) {
            this.init();
          } else {
            // Re-render setup to show only Gemini key field (BUG-07 fix: guard parentNode)
            const parent = this._wrapper?.parentNode;
            if (parent) {
              this._buildUI(parent);
            } else {
              this.init();
            }
          }
        },
        onSaveGemini: (key) => {
          GM_setValue(KEY_GEMINI_API, key);
          // Only init if both keys are now present
          if (this._hasKey()) {
            this.init();
          } else {
            // Re-render setup to show only Groq key field (BUG-07 fix: guard parentNode)
            const parent = this._wrapper?.parentNode;
            if (parent) {
              this._buildUI(parent);
            } else {
              this.init();
            }
          }
        },
        // BUG-15 fix: removed legacy onSave callback that was interfering with per-key routing
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
        onDownload: async () => {  // BUG-17: async to handle async download methods
          if (this.tab === 'ai') {
            if (!this._cache[this._cacheKey()]) return;
            await this._downloadSummary();  // BUG-17: await async
            UI.flash(this._wrapper, '#ytai-dl', '#ytai-dl-lbl', 'Saved ✓', 'Export .md');
          } else {
            if (!this.data.length) return;
            await this._downloadTranscript();  // BUG-17: await async
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
      const gen = ++this._fetchGen;
      console.log('[YT AI] Fetching transcript, gen:', gen, 'lang:', this._getTLang(), 'videoId:', this.videoId);
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

        // Discard stale results
        if (gen !== this._fetchGen) return;

        this.data = data;
        this._fetchMethod = method;
        this._renderTab();
        this._startSync();
        await this._detectSponsors();
      } catch (e) {
        // Discard stale errors
        if (gen !== this._fetchGen) return;
        console.error('[YT AI] All methods failed:', e.message);
        if (bodyEl) {
          UI.setBodyEl(bodyEl, `
            <div class="ytai-error">
              Transcript not available.<br>
              <small>Make sure the video has captions (CC) enabled.</small><br><br>
              <small>${escapeHTML(e.message)}</small>
            </div>
          `);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sponsor Detection
    // ─────────────────────────────────────────────────────────────────────────
    async _detectSponsors() {
      const gen = ++this._sponsorGen;  // Fix 2: increment first, then capture
      const groqKey = GM_getValue(KEY_API, '');
      const geminiKey = GM_getValue(KEY_GEMINI_API, '');
      if (!groqKey) return;

      try {
        const segments = await SPONSOR.detectSponsors(this.videoId, this.data, groqKey, geminiKey);

        // BUG-12: discard stale results
        if (gen !== this._sponsorGen) return;

        this._sponsorSegments = segments;

        if (segments.length > 0) {
          this._attachSkipper();
          await this._paintSeekbarSegments();
        }

        if (this.tab === 'settings') {
          this._renderSettings();
        }
      } catch (e) {
        // BUG-12: discard stale errors
        if (gen !== this._sponsorGen) return;
        console.warn('[YT AI] Sponsor detection failed:', e);
      }
    }

    _attachSkipper() {
      if (this._skipperAttached) return;
      const video = doc.querySelector('video');
      if (!video) return;

      this._videoEl = video; // Store reference for proper cleanup (Bug 5 fix)
      this._skipListener = SPONSOR.attachSkipper(
        video,
        this._sponsorSegments,
        (type) => this._getSkipType(type)
      );
      this._skipperAttached = true;
    }

    _detachSkipper() {
      if (!this._skipperAttached) return;
      // Fix: Dismiss any active prompts before removing listener (prevents keydown leaks)
      SPONSOR.dismissAllPrompts();
      // Use stored video reference, not fresh query (Bug 5 fix)
      SPONSOR.detachSkipper(this._videoEl, this._skipListener);
      this._videoEl = null;
      this._skipListener = null;
      this._skipperAttached = false;
    }

    async _paintSeekbarSegments(retries = 0) {
      const video = doc.querySelector('video');
      if (!video?.duration) {
        // Retry with max 5 attempts
        if (retries < 5) {
          await new Promise(r => setTimeout(r, 1500));
          return this._paintSeekbarSegments(retries + 1);
        }
        return;
      }

      // Use async version with callback to track observer even on retry
      // Pass videoId as sessionId to prevent stale repaint after navigation (BUG-06 fix)
      this._seekbarObserver = await SPONSOR.paintSeekbarSegments(
        this._sponsorSegments,
        video.duration,
        UI.fmtTime,
        0, // retryCount
        (observer) => { this._seekbarObserver = observer; }, // callback for retry case
        this.videoId // sessionId for stale-check
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

      // BUG-14 safety: don't render transcript into setup screen
      if (bodyEl.classList.contains('ytai-body--setup')) return;

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

      // Check if Gemini key is missing - show error
      if (!this._hasGeminiKey()) {
        UI.setBodyEl(bodyEl, UI.htmlGeminiMissing());
        // Add click handler for the settings link
        setTimeout(() => {
          const link = bodyEl?.querySelector('#ytai-gemini-setup-link');
          if (link) {
            link.onclick = () => {
              this._prevTab = this.tab;
              this.tab = 'settings';
              this._renderTab();
            };
          }
        }, 0);
        return;
      }

      const ck = this._cacheKey();
      if (this._cache[ck]) {
        const html = UI.paintSummary(this._cache[ck], this._cache[ck + '__model']);
        UI.setBodyEl(bodyEl, html);
        return;
      }

      this._callAI();
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
        hasGeminiKey: this._hasGeminiKey(),
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
        onSaveGroqKey: (key) => {
          GM_setValue(KEY_API, key);
          const inp = this._wrapper.querySelector('#ytai-settings-key-groq');
          const statusEl = this._wrapper.querySelector('#ytai-key-status-groq');
          const statusText = this._wrapper.querySelector('#ytai-key-status-text-groq');
          const feedback = this._wrapper.querySelector('#ytai-save-feedback-groq');

          if (inp) inp.value = '●●●●●●●●' + key.slice(-4);
          if (statusEl) statusEl.className = 'ytai-key-status connected';
          if (statusText) statusText.textContent = 'Connected';
          if (feedback) {
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2500);
          }

          // If Gemini key was added while we were missing it, re-render settings
          if (this._hasGeminiKey()) {
            this._renderSettings();
          }
        },
        onClearGroqKey: () => {
          GM_setValue(KEY_API, '');
          this.init();
        },
        onSaveGeminiKey: (key) => {
          GM_setValue(KEY_GEMINI_API, key);
          const inp = this._wrapper.querySelector('#ytai-settings-key-gemini');
          const statusEl = this._wrapper.querySelector('#ytai-key-status-gemini');
          const statusText = this._wrapper.querySelector('#ytai-key-status-text-gemini');
          const feedback = this._wrapper.querySelector('#ytai-save-feedback-gemini');

          if (inp) inp.value = '●●●●●●●●' + key.slice(-4);
          if (statusEl) statusEl.className = 'ytai-key-status connected';
          if (statusText) statusText.textContent = 'Connected';
          if (feedback) {
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2500);
          }

          // Re-render to show the clear button
          this._renderSettings();
        },
        onClearGeminiKey: () => {
          GM_setValue(KEY_GEMINI_API, '');
          // If on AI tab, go back to transcript since AI won't work
          if (this.tab === 'ai') {
            this.tab = 'transcript';
            this._renderTab();
          } else {
            this._renderSettings();
          }
        },
        // BUG-15 fix: removed legacy onSaveKey/onClearKey callbacks
        onTLangChange: (value) => {
          console.log('[YT AI] Transcript language changed to:', value);
          this._setTLang(value);
          this.data = [];
          // Clear sponsor state since transcript changed
          this._sponsorSegments = [];
          this._detachSkipper();
          this._detachSeekbarObserver();
          // Invalidate AI summary cache (based on old transcript)
          const cacheKey = this._cacheKey();
          delete this._cache[cacheKey];
          delete this._cache[cacheKey + '__model'];
          if (this.tab === 'settings') {
            this.tab = this._prevTab || 'transcript';
          }
          this._renderTab();
          this._fetchTranscript();
        },
        onSLangChange: (value) => {
          const oldCacheKey = this._cacheKey(); // compute BEFORE changing language
          this._setSLang(value);
          delete this._cache[oldCacheKey];
          delete this._cache[oldCacheKey + '__model'];
          const fb = this._wrapper.querySelector('#ytai-lang-feedback');
          if (fb) {
            fb.classList.add('show');
            setTimeout(() => fb.classList.remove('show'), 3000);
          }
          // Re-render summary in new language if currently on AI tab
          if (this.tab === 'ai') this._renderSummary();
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
    async _callAI() {
      const gen = ++this._aiGen;
      const bodyEl = this._wrapper?.querySelector('#ytai-body');
      const setBody = (html) => UI.setBodyEl(bodyEl, html);

      const groqKey = GM_getValue(KEY_API, '');
      const geminiKey = GM_getValue(KEY_GEMINI_API, '');

      // Check if Gemini key is required but missing
      if (!geminiKey) {
        UI.setBodyEl(bodyEl, UI.htmlGeminiMissing());
        // Add click handler for the settings link
        setTimeout(() => {
          const link = bodyEl?.querySelector('#ytai-gemini-setup-link');
          if (link) {
            link.onclick = () => {
              this._prevTab = this.tab;
              this.tab = 'settings';
              this._renderTab();
            };
          }
        }, 0);
        return;
      }

      try {
        // BUG-17: Wait for fresh channel/title data from DOM
        const channelName = await this._readChannel();
        const title = await this._readTitle();

        // OPT-03: cut at word boundary instead of mid-word
        const fullText = this.data.map(l => l.text).join(' ');
        const transcriptText = fullText.length > 90000
          ? fullText.substring(0, fullText.lastIndexOf(' ', 90000))
          : fullText;

        // Step 1: Groq generation
        const groqResult = await GROQ.callSummaryWithUI(
          groqKey,
          transcriptText,
          channelName,
          this._getSLang(),
          setBody
        );

        // Discard stale results
        if (gen !== this._aiGen) return;

        if (!groqResult) {
          UI.setBodyEl(bodyEl, '<div class="ytai-error">No result from AI. Please try again.</div>');
          return;
        }

        // Step 2: Gemini review
        setBody(`<div class="ytai-loading">${CONSTANTS.SVG.sparkles}<span>Reviewing with Gemini…</span></div>`);

        let finalResult = groqResult;
        try {
          finalResult = await GEMINI.reviewSummary(geminiKey, groqResult);
          console.log('[YT AI] Gemini review complete');
        } catch (geminiErr) {
          console.warn('[YT AI] Gemini review failed, using Groq result:', geminiErr.message);
          finalResult = groqResult;
        }

        // Discard stale results
        if (gen !== this._aiGen) return;

        const ck = this._cacheKey();
        this._cache[ck] = {
          keypoints: finalResult.keypoints,
          summary: finalResult.summary,
        };
        this._cache[ck + '__model'] = finalResult.model;
        this._saveCache();

        UI.setBodyEl(bodyEl, UI.paintSummary(finalResult, finalResult.model));
      } catch (e) {
        // Discard stale errors
        if (gen !== this._aiGen) return;
        console.error('[YT AI]', e);
        UI.setBodyEl(bodyEl, `<div class="ytai-error">AI error: ${escapeHTML(e.message)}</div>`);
      }
    }

    // Legacy alias
    async _callGroq() {
      return this._callAI();
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

      const keypoints = sanitizeKeypoints(
        Array.isArray(j?.keypoints) ? j.keypoints
          : Array.isArray(j?.key_points) ? j.key_points
          : Array.isArray(j?.punti_chiave) ? j.punti_chiave : []
      );
      const summary = j?.summary || j?.riassunto || j?.sintesi || '';

      const points = keypoints.map(p => `• ${UI.toPlainText(p)}`).join('\n');
      const summaryText = UI.toPlainText(UI.sanitizeSummary(summary));

      return `KEY POINTS\n\n${points}\n\nSUMMARY\n\n${summaryText}\n\n---\n${CONSTANTS.FOOTER}`;
    }

    async _summaryMarkdown() {
      const j = this._cache[this._cacheKey()];
      if (!j) return '';

      const keypoints = sanitizeKeypoints(
        Array.isArray(j?.keypoints) ? j.keypoints
          : Array.isArray(j?.key_points) ? j.key_points
          : Array.isArray(j?.punti_chiave) ? j.punti_chiave : []
      );
      const summary = j?.summary || j?.riassunto || j?.sintesi || '';

      const title = (await this._readTitle()) || this.videoId;  // BUG-17: await async read
      const date = new Date().toISOString().slice(0, 10);
      const points = keypoints.map(p => `- ${UI.toCleanMd(p)}`).join('\n');
      const summaryText = UI.toCleanMdParagraph(UI.sanitizeSummary(summary));

      return `# ${title}\n\n> Generated on ${date}\n\n## Key Points\n\n${points}\n\n## Summary\n\n${summaryText}\n\n---\n*${CONSTANTS.FOOTER}*`;
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

    async _downloadTranscript() {
      const title = await this._readTitle();  // BUG-17: await async read
      this._dl(this._transcriptText(), `${this._safeFilename(title)}.txt`, 'text/plain');
    }

    async _downloadSummary() {
      const title = await this._readTitle();  // BUG-17: await async read
      const content = await this._summaryMarkdown();  // BUG-17: await async method
      this._dl(content, `${this._safeFilename(title)}_summary.md`, 'text/markdown');
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

  // BUG-08 fix: add debounce to prevent rapid init() calls
  let _lastInitTime = 0;
  const DEBOUNCE_MS = 2000;
  function runDebounced() {
    const now = Date.now();
    if (now - _lastInitTime < DEBOUNCE_MS) return;
    _lastInitTime = now;
    run();
  }

  setInterval(runDebounced, 5000);  // OPT-02: increased from 1500ms to 5000ms
  doc.readyState !== 'loading' ? run() : doc.addEventListener('DOMContentLoaded', run);
  doc.addEventListener('yt-navigate-finish', run);

  // Log initialization
  console.log('[YT AI] YouTube Transcript & AI Assistant v5.0 (Modular) initialized');
})();
