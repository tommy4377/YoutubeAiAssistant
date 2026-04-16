// sponsor.js - YouTube AI Assistant v5.0 - Sponsor Detection & Skip Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  const UTILS = window.YTAI?.UTILS;
  const GROQ = window.YTAI?.GROQ;
  const GEMINI = window.YTAI?.GEMINI;

  if (!CONSTANTS || !UTILS || !GROQ || !GEMINI) {
    console.error('[YTAI Sponsor] Dependencies missing. Ensure constants.js, groq.js, gemini.js are loaded first.');
    return;
  }

  const {
    SEG_COLORS,
    SEG_TYPE_SPONSOR,
    KEY_SPONSOR_CACHE,
    SPONSOR_CACHE_MAX,
    SPONSOR_MODEL,
    C,
  } = CONSTANTS;
  const { doc, escapeHTML, setHTML } = UTILS;

  // ───────────────────────────────────────────────────────────────────────────
  // Cache Management
  // ───────────────────────────────────────────────────────────────────────────
  const loadCache = () => {
    try {
      return JSON.parse(GM_getValue(KEY_SPONSOR_CACHE, '{}'));
    } catch {
      return {};
    }
  };

  const saveCache = (cache) => {
    try {
      GM_setValue(KEY_SPONSOR_CACHE, JSON.stringify(cache));
    } catch (_) { /* ignore */ }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Detection Orchestrator (1 Groq call + 1 Gemini review)
  // ───────────────────────────────────────────────────────────────────────────
  const detectSponsors = async (videoId, data, groqKey, geminiKey) => {
    if (!data?.length || !videoId) {
      return [];
    }

    const cache = loadCache();
    if (cache[videoId]) {
      console.log(`[YT AI] Sponsor cache hit: ${cache[videoId].length} segment(s)`);
      return cache[videoId];
    }

    const slim = data.map(l => ({ t: Math.round(l.start), s: l.text }));
    const transcriptJson = JSON.stringify(slim).substring(0, 15000);
    const model = SPONSOR_MODEL;

    console.log('[YT AI] Sponsor detection: Groq call…');

    let groqSegments = [];
    try {
      groqSegments = await GROQ.callSponsor(groqKey, transcriptJson, model);
    } catch (e) {
      if (e.status === 429) {
        console.warn('[YT AI] Sponsor call rate limited (429)');
      } else {
        console.warn('[YT AI] Sponsor call failed:', e.message);
      }
      // BUG-10 fix: don't cache empty results on error - return without saving to cache
      return [];
    }

    console.log(`[YT AI] Sponsor detection: Groq found ${groqSegments.length} segment(s)`);

    let finalSegments = groqSegments;

    // If we have Gemini key and Groq found segments, review with Gemini
    if (geminiKey && groqSegments.length > 0) {
      console.log('[YT AI] Sponsor detection: Gemini review…');
      try {
        finalSegments = await GEMINI.reviewSponsors(geminiKey, groqSegments, data);
        console.log(`[YT AI] Sponsor detection: Gemini confirmed ${finalSegments.length} segment(s)`);
      } catch (e) {
        console.warn('[YT AI] Gemini sponsor review failed, using Groq result:', e.message);
        finalSegments = groqSegments;
      }
    }

    // Save to cache (BUG-02 fix: reuse the first cache object)
    cache[videoId] = finalSegments;
    const keys = Object.keys(cache);
    if (keys.length > SPONSOR_CACHE_MAX) {
      keys.slice(0, keys.length - SPONSOR_CACHE_MAX).forEach(k => delete cache[k]);
    }
    saveCache(cache);

    console.log(`[YT AI] Sponsor detection: ${finalSegments.length} segment(s) saved to cache`);
    return finalSegments;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Skip Logic
  // ───────────────────────────────────────────────────────────────────────────
  const attachSkipper = (video, segments, skipTypeGetter) => {
    const listener = () => {
      const ct = video.currentTime;
      for (const seg of segments) {
        // Check if this type is enabled for skipping
        if (!skipTypeGetter(seg.type || SEG_TYPE_SPONSOR)) continue;

        if (ct >= seg.start - 0.3 && ct < seg.end) {
          video.currentTime = seg.end;
          showSkipToast(seg.label || 'Segment', seg.type);
          break;
        }
      }
    };

    video.addEventListener('timeupdate', listener);
    return listener;
  };

  const detachSkipper = (video, listener) => {
    if (video && listener) {
      video.removeEventListener('timeupdate', listener);
    }
  };

  const showSkipToast = (label, type) => {
    const existing = doc.getElementById('ytai-skip-toast');
    if (existing) existing.remove();

    const color = SEG_COLORS[type] || C.warning;
    const toast = doc.createElement('div');
    toast.id = 'ytai-skip-toast';
    setHTML(toast, `⏭ Skipped <span style="color:${color}">${escapeHTML(label)}</span>`);
    doc.body.appendChild(toast);

    setTimeout(() => {
      if (doc.getElementById('ytai-skip-toast') === toast) {
        toast.remove();
      }
    }, 3000);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Seekbar Overlay
  // ───────────────────────────────────────────────────────────────────────────
  let _currentSeekbarObserver = null;

  const getProgressBar = () => doc.querySelector('.ytp-progress-bar');

  const paintSeekbarSegments = async (segments, duration, fmtTimeFn, _retryCount = 0, onObserverCreated = null, sessionId = null) => {
    removeSeekbarOverlay();
    if (!segments?.length || !duration) return null;

    const bar = getProgressBar();
    if (!bar) {
      // Retry after delay (max 5 retries)
      if (_retryCount < 5) {
        await new Promise(r => setTimeout(r, 1500));
        return paintSeekbarSegments(segments, duration, fmtTimeFn, _retryCount + 1, onObserverCreated, sessionId);
      }
      return null;
    }

    // Ensure position:relative for absolute children
    if (getComputedStyle(bar).position === 'static') {
      bar.style.position = 'relative';
    }

    const overlay = doc.createElement('div');
    overlay.id = 'ytai-segment-overlay';

    for (const seg of segments) {
      const color = SEG_COLORS[seg.type] || C.warning;
      const left = (seg.start / duration) * 100;
      const width = ((seg.end - seg.start) / duration) * 100;
      const div = doc.createElement('div');
      div.className = 'ytai-seg-bar';
      div.style.left = `${left}%`;
      div.style.width = `${width}%`;
      div.style.background = color;
      div.title = `[${seg.type || 'segment'}] ${seg.label || ''} (${fmtTimeFn(seg.start)} → ${fmtTimeFn(seg.end)})`;
      overlay.appendChild(div);
    }

    bar.appendChild(overlay);

    // Disconnect any existing observer before creating a new one
    if (_currentSeekbarObserver) {
      _currentSeekbarObserver.disconnect();
    }
    _currentSeekbarObserver = attachSeekbarObserver(bar, segments, duration, fmtTimeFn, onObserverCreated, sessionId);

    // Notify caller about the observer (even on retry)
    if (onObserverCreated) {
      onObserverCreated(_currentSeekbarObserver);
    }

    return _currentSeekbarObserver;
  };

  const removeSeekbarOverlay = () => {
    doc.getElementById('ytai-segment-overlay')?.remove();
  };

  const attachSeekbarObserver = (bar, segments, duration, fmtTimeFn, onObserverCreated = null, sessionId = null) => {
    const observer = new MutationObserver(() => {
      if (!doc.getElementById('ytai-segment-overlay') && segments.length) {
        // Disconnect this observer to prevent duplicate triggers
        observer.disconnect();
        setTimeout(() => {
          // Only repaint if still on the same video (BUG-06 fix)
          const currentVideoId = new URLSearchParams(location.search).get('v');
          if (sessionId && currentVideoId !== sessionId) return;
          paintSeekbarSegments(segments, duration, fmtTimeFn, 0, onObserverCreated, sessionId);
        }, 300);
      }
    });
    observer.observe(bar, { childList: true });
    return observer;
  };

  const detachSeekbarObserver = (observer) => {
    if (observer) {
      observer.disconnect();
    }
    if (_currentSeekbarObserver === observer) {
      _currentSeekbarObserver = null;
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.SPONSOR = {
    // Detection
    detectSponsors,
    loadCache,
    saveCache,
    // Skip logic
    attachSkipper,
    detachSkipper,
    showSkipToast,
    // Seekbar overlay
    getProgressBar,
    paintSeekbarSegments,
    removeSeekbarOverlay,
    attachSeekbarObserver,
    detachSeekbarObserver,
  };
})();
