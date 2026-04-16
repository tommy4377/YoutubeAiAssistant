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
  // Detection Orchestrator (chunked Groq calls + 1 Gemini review)
  // ───────────────────────────────────────────────────────────────────────────
  const CHUNK_SIZE = 175; // lines per chunk (~5-7KB JSON each, well under Groq limits)

  const detectSponsors = async (videoId, data, groqKey, geminiKey) => {
    if (!data?.length || !videoId) {
      return [];
    }

    const cache = loadCache();
    if (cache[videoId]) {
      console.log(`[YT AI] Sponsor cache hit: ${cache[videoId].length} segment(s)`);
      return cache[videoId];
    }

    // Build slim transcript array with absolute timestamps
    const slim = data.map(l => ({ t: Math.round(l.start), s: l.text }));
    
    // Split into chunks for full transcript coverage
    const chunks = [];
    for (let i = 0; i < slim.length; i += CHUNK_SIZE) {
      // Add overlap: include last 10 lines of previous chunk for transition continuity
      const startIdx = i === 0 ? 0 : Math.max(0, i - 10);
      const endIdx = Math.min(slim.length, i + CHUNK_SIZE);
      chunks.push(slim.slice(startIdx, endIdx));
    }

    const model = SPONSOR_MODEL;
    console.log(`[YT AI] Sponsor detection: ${chunks.length} chunk(s), ${slim.length} lines total`);

    // Process chunks sequentially to respect rate limits
    const allGroqSegments = [];
    const seenKeys = new Set(); // For deduplication

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkJson = JSON.stringify(chunk);
      console.log(`[YT AI] Sponsor detection: chunk ${i + 1}/${chunks.length} (${chunkJson.length} chars, ${chunk.length} lines)…`);

      try {
        const segs = await GROQ.callSponsor(groqKey, chunkJson, model);
        if (segs?.length) {
          console.log(`[YT AI] Sponsor detection: chunk ${i + 1} found ${segs.length} segment(s)`);
          // Deduplicate by (start, type) key - segments at chunk boundaries may appear in both chunks
          for (const seg of segs) {
            const key = `${seg.start}-${seg.type}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allGroqSegments.push(seg);
            }
          }
        }
      } catch (e) {
        if (e.status === 429) {
          // Rate limit - stop processing but keep segments from completed chunks
          console.warn(`[YT AI] Sponsor chunk ${i + 1} rate limited (429), using ${allGroqSegments.length} segment(s) from completed chunks`);
          break;
        }
        // Other errors - log and continue to next chunk
        console.warn(`[YT AI] Sponsor chunk ${i + 1} failed:`, e.message);
      }
    }

    console.log(`[YT AI] Sponsor detection: Groq found ${allGroqSegments.length} unique segment(s) across all chunks`);

    let finalSegments = allGroqSegments;

    // Global Gemini review across all detected segments
    if (geminiKey && allGroqSegments.length > 0) {
      console.log('[YT AI] Sponsor detection: Gemini review of combined segments…');
      try {
        finalSegments = await GEMINI.reviewSponsors(geminiKey, allGroqSegments, data);
        console.log(`[YT AI] Sponsor detection: Gemini confirmed ${finalSegments.length} segment(s)`);
      } catch (e) {
        console.warn('[YT AI] Gemini sponsor review failed, using Groq result:', e.message);
        finalSegments = allGroqSegments;
      }
    }

    // Safety filter: remove segments under 5 seconds (false positives)
    const filteredSegments = finalSegments.filter(seg => {
      const duration = seg.end - seg.start;
      if (duration < 5) {
        console.log(`[YT AI] Filtered out short segment (${duration}s): ${seg.type} - too short to be valid`);
        return false;
      }
      return true;
    });

    // Save to cache (BUG-02 fix: reuse the first cache object)
    cache[videoId] = filteredSegments;
    const keys = Object.keys(cache);
    if (keys.length > SPONSOR_CACHE_MAX) {
      keys.slice(0, keys.length - SPONSOR_CACHE_MAX).forEach(k => delete cache[k]);
    }
    saveCache(cache);

    console.log(`[YT AI] Sponsor detection: ${filteredSegments.length} segment(s) saved to cache (${finalSegments.length - filteredSegments.length} filtered out)`);
    return filteredSegments;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Skip Logic
  // ───────────────────────────────────────────────────────────────────────────
  // Track the active prompt globally so it can be dismissed externally
  let _activePrompt = null;

  // Fix: Export dismiss function for main.js to call during cleanup
  const dismissAllPrompts = () => {
    if (_activePrompt) {
      _activePrompt.dismiss();
      _activePrompt = null;
    }
    // Also remove any orphaned DOM elements
    const existing = doc.getElementById('ytai-skip-prompt');
    if (existing) existing.remove();
  };

  // Fix 4: New attachSkipper with prompt mode support
  const attachSkipper = (video, segments, skipTypeGetter) => {
    const listener = () => {
      const ct = video.currentTime;

      for (const seg of segments) {
        const autoSkip = skipTypeGetter(seg.type || SEG_TYPE_SPONSOR);

        if (ct >= seg.start - 0.3 && ct < seg.end) {
          if (autoSkip) {
            // Auto-skip: jump immediately, dismiss any prompt
            _dismissPrompt();
            video.currentTime = seg.end;
            showSkipToast(seg.label || 'Segment', seg.type);
            break;
          } else {
            // Prompt mode: show persistent prompt if not already showing for this segment
            if (!_activePrompt || _activePrompt.segStart !== seg.start) {
              _dismissPrompt();
              _activePrompt = showSkipPrompt(seg, video, () => { _activePrompt = null; });
            }
            return; // inside a prompt segment, don't check others
          }
        }
      }

      // If we're outside all segments, dismiss any open prompt
      const stillInSeg = segments.some(seg =>
        !skipTypeGetter(seg.type || SEG_TYPE_SPONSOR) &&
        ct >= seg.start - 0.3 && ct < seg.end
      );
      if (!stillInSeg && _activePrompt) {
        _dismissPrompt();
      }

      function _dismissPrompt() {
        if (_activePrompt) {
          _activePrompt.dismiss(); // Fix: use dismiss() not remove() to avoid recursion
          _activePrompt = null;
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
    // Fix: clear active prompt reference when skipper is detached
    _activePrompt = null;
  };

  const showSkipToast = (label, type) => {
    const existing = doc.getElementById('ytai-skip-toast');
    if (existing) existing.remove();

    const color = SEG_COLORS[type] || C.warning;
    const toast = doc.createElement('div');
    toast.id = 'ytai-skip-toast';
    setHTML(toast, `⏭ Skipped <span style="color:${color}">${escapeHTML(label)}</span>`);

    // Fix: Append to player container (like skip prompt) so it positions inside video
    const playerContainer = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player') || doc.body;
    playerContainer.appendChild(toast);

    setTimeout(() => {
      if (doc.getElementById('ytai-skip-toast') === toast) {
        toast.remove();
      }
    }, 3000);
  };

  // Fix 4: New showSkipPrompt function for manual skip mode
  const showSkipPrompt = (seg, video, onDismiss) => {
    const existing = doc.getElementById('ytai-skip-prompt');
    if (existing) existing.remove();

    const color = SEG_COLORS[seg.type] || C.warning;
    const prompt = doc.createElement('div');
    prompt.id = 'ytai-skip-prompt';

    // Find the best container: prefer the YouTube player div so it works in fullscreen
    const playerContainer = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player') || doc.body;

    setHTML(prompt, `
      <span style="color:${color};font-weight:600">${escapeHTML(seg.label || 'Segment')}</span>
      <span style="color:rgba(255,255,255,.5);margin:0 6px">—</span>
      <span style="color:rgba(255,255,255,.75);font-size:12px">Press</span>
      <kbd>Enter</kbd>
      <span style="color:rgba(255,255,255,.75);font-size:12px">to skip</span>
    `);

    playerContainer.appendChild(prompt);

    let dismissed = false; // Fix: track dismissal state to prevent double cleanup

    // Keyboard handler
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        video.currentTime = seg.end;
        showSkipToast(seg.label || 'Segment', seg.type);
        doCleanup();
      }
    };

    const doCleanup = () => {
      if (dismissed) return; // Fix: prevent double execution
      dismissed = true;
      doc.removeEventListener('keydown', onKey, true);
      // Fix: use native DOM remove directly, not custom method
      if (prompt.parentNode) {
        prompt.parentNode.removeChild(prompt);
      }
      if (onDismiss) onDismiss();
    };

    doc.addEventListener('keydown', onKey, true);

    // Attach segStart so the caller can compare
    prompt.segStart = seg.start;

    // Expose dismiss method for external cleanup (fixed: no name collision)
    prompt.dismiss = doCleanup;

    return prompt;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Seekbar Overlay
  // ───────────────────────────────────────────────────────────────────────────
  let _currentSeekbarObserver = null;
  let _isPainting = false; // Fix 1: guard against concurrent repaints

  const getProgressBar = () => doc.querySelector('.ytp-progress-bar');

  const paintSeekbarSegments = async (segments, duration, fmtTimeFn, _retryCount = 0, onObserverCreated = null, sessionId = null) => {
    if (_isPainting) return null; // Fix 1: prevent concurrent repaints
    _isPainting = true;
    try {
      removeSeekbarOverlay();
      if (!segments?.length || !duration) return null;

      const bar = getProgressBar();
      if (!bar) {
        if (_retryCount < 5) {
          await new Promise(r => setTimeout(r, 1500));
          _isPainting = false; // Fix: reset guard before retry so recursive call can proceed
          return paintSeekbarSegments(segments, duration, fmtTimeFn, _retryCount + 1, onObserverCreated, sessionId);
        }
        return null;
      }

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

      if (_currentSeekbarObserver) {
        _currentSeekbarObserver.disconnect();
      }
      _currentSeekbarObserver = attachSeekbarObserver(bar, segments, duration, fmtTimeFn, onObserverCreated, sessionId);

      if (onObserverCreated) {
        onObserverCreated(_currentSeekbarObserver);
      }

      return _currentSeekbarObserver;
    } finally {
      _isPainting = false; // Fix 1: reset guard
    }
  };

  const removeSeekbarOverlay = () => {
    doc.getElementById('ytai-segment-overlay')?.remove();
  };

  const attachSeekbarObserver = (bar, segments, duration, fmtTimeFn, onObserverCreated = null, sessionId = null) => {
    const observer = new MutationObserver(() => {
      if (!doc.getElementById('ytai-segment-overlay') && segments.length) {
        observer.disconnect();
        setTimeout(() => {
          const currentVideoId = new URLSearchParams(location.search).get('v');
          if (sessionId && currentVideoId !== sessionId) return;
          // Fix 1: double-check still missing before repainting
          if (!doc.getElementById('ytai-segment-overlay')) {
            paintSeekbarSegments(segments, duration, fmtTimeFn, 0, onObserverCreated, sessionId);
          }
        }, 500); // Fix 1: increased from 300 to 500ms for DOM to settle
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
    showSkipPrompt, // Fix 4: export new prompt function
    dismissAllPrompts, // Fix: export dismiss function for cleanup
    // Seekbar overlay
    getProgressBar,
    paintSeekbarSegments,
    removeSeekbarOverlay,
    attachSeekbarObserver,
    detachSeekbarObserver,
  };
})();
