// sponsor.js - YouTube AI Assistant v5.0 - Sponsor Detection & Skip Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  const UTILS = window.YTAI?.UTILS;
  const GROQ = window.YTAI?.GROQ;

  if (!CONSTANTS || !UTILS || !GROQ) {
    console.error('[YTAI Sponsor] Dependencies missing. Ensure constants.js, groq.js are loaded first.');
    return;
  }

  const {
    SEG_COLORS,
    SEG_TYPE_SPONSOR,
    KEY_SPONSOR_CACHE,
    SPONSOR_CACHE_MAX,
    C,
  } = CONSTANTS;
  const { doc, escapeHTML, setHTML, selectGroqModel } = UTILS;

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
  // Majority Vote Logic
  // ───────────────────────────────────────────────────────────────────────────
  const majorityVote = (results) => {
    const [r0, r1, r2] = results;
    const allCalls = [r0, r1, r2];
    const confirmed = [];

    for (let ci = 0; ci < allCalls.length; ci++) {
      for (const seg of allCalls[ci]) {
        const segDuration = seg.end - seg.start;
        if (segDuration <= 0) continue;

        let votes = 0;
        for (let cj = 0; cj < allCalls.length; cj++) {
          const hasOverlap = allCalls[cj].some(other => {
            const overlapStart = Math.max(seg.start, other.start);
            const overlapEnd = Math.min(seg.end, other.end);
            const overlap = overlapEnd - overlapStart;
            return overlap / segDuration >= 0.5;
          });
          if (hasOverlap) votes++;
        }

        if (votes >= 2) {
          const isDuplicate = confirmed.some(c => {
            const overlapStart = Math.max(seg.start, c.start);
            const overlapEnd = Math.min(seg.end, c.end);
            return (overlapEnd - overlapStart) / segDuration >= 0.5;
          });
          if (!isDuplicate) confirmed.push(seg);
        }
      }
    }

    return confirmed;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Detection Orchestrator
  // ───────────────────────────────────────────────────────────────────────────
  const detectSponsors = async (videoId, data, apiKey) => {
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
    const model = selectGroqModel(transcriptJson.length);

    console.log('[YT AI] Sponsor detection: running 3 parallel calls for majority vote…');

    // Triple-check with majority vote
    const results = await Promise.all([
      GROQ.callSponsor(apiKey, transcriptJson, model),
      GROQ.callSponsor(apiKey, transcriptJson, model),
      GROQ.callSponsor(apiKey, transcriptJson, model),
    ]);

    console.log('[YT AI] Raw sponsor results:', results.map(r => r.length));

    const segments = majorityVote(results);

    // Save to cache
    const c = loadCache();
    c[videoId] = segments;
    const keys = Object.keys(c);
    if (keys.length > SPONSOR_CACHE_MAX) {
      keys.slice(0, keys.length - SPONSOR_CACHE_MAX).forEach(k => delete c[k]);
    }
    saveCache(c);

    console.log(`[YT AI] Sponsor detection: ${segments.length} confirmed segment(s) after majority vote`);
    return segments;
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
  const getProgressBar = () => doc.querySelector('.ytp-progress-bar');

  const paintSeekbarSegments = (segments, duration, fmtTimeFn) => {
    removeSeekbarOverlay();
    if (!segments?.length || !duration) return null;

    const bar = getProgressBar();
    if (!bar) {
      // Retry after delay
      setTimeout(() => paintSeekbarSegments(segments, duration, fmtTimeFn), 1500);
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

    // Return observer for re-attachment on DOM changes
    return attachSeekbarObserver(bar, segments, duration, fmtTimeFn);
  };

  const removeSeekbarOverlay = () => {
    doc.getElementById('ytai-segment-overlay')?.remove();
  };

  const attachSeekbarObserver = (bar, segments, duration, fmtTimeFn) => {
    const observer = new MutationObserver(() => {
      if (!doc.getElementById('ytai-segment-overlay') && segments.length) {
        setTimeout(() => paintSeekbarSegments(segments, duration, fmtTimeFn), 300);
      }
    });
    observer.observe(bar, { childList: true });
    return observer;
  };

  const detachSeekbarObserver = (observer) => {
    if (observer) {
      observer.disconnect();
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.SPONSOR = {
    // Detection
    majorityVote,
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
