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
  // Agreement Calculation (measures overlap between two results)
  // ───────────────────────────────────────────────────────────────────────────
  const computeAgreement = (r0, r1) => {
    if (!r0.length && !r1.length) return 1; // Both empty = perfect agreement
    if (!r0.length || !r1.length) return 0; // One empty, one not = no agreement

    let totalAgreement = 0;
    let totalSegments = 0;

    // Check agreement for r0 segments
    for (const seg of r0) {
      const segDuration = seg.end - seg.start;
      if (segDuration <= 0) continue;

      const hasOverlap = r1.some(other => {
        const overlapStart = Math.max(seg.start, other.start);
        const overlapEnd = Math.min(seg.end, other.end);
        const overlap = overlapEnd - overlapStart;
        return overlap / segDuration >= 0.5;
      });

      totalAgreement += hasOverlap ? 1 : 0;
      totalSegments++;
    }

    // Check agreement for r1 segments (reverse)
    for (const seg of r1) {
      const segDuration = seg.end - seg.start;
      if (segDuration <= 0) continue;

      const hasOverlap = r0.some(other => {
        const overlapStart = Math.max(seg.start, other.start);
        const overlapEnd = Math.min(seg.end, other.end);
        const overlap = overlapEnd - overlapStart;
        return overlap / segDuration >= 0.5;
      });

      totalAgreement += hasOverlap ? 1 : 0;
      totalSegments++;
    }

    return totalSegments > 0 ? totalAgreement / totalSegments : 0;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Majority Vote Logic (works with 2 or 3 results)
  // ───────────────────────────────────────────────────────────────────────────
  const majorityVote = (results) => {
    const confirmed = [];
    const allCalls = results;

    // Need at least 2 votes out of N calls
    const minVotes = 2;

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

        if (votes >= minVotes) {
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
  // Detection Orchestrator (2 sequential calls + conditional 3rd tiebreaker)
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
    const model = SPONSOR_MODEL; // Always use cheapest model for sponsor detection

    console.log('[YT AI] Sponsor detection: running 2 sequential calls…');

    // First 2 calls - sequential (queued by groq.js with 2s gap)
    const r0 = await GROQ.callSponsor(apiKey, transcriptJson, model);
    const r1 = await GROQ.callSponsor(apiKey, transcriptJson, model);

    console.log('[YT AI] Raw sponsor results:', [r0.length, r1.length]);

    // Check agreement between first 2 calls
    const agreement = computeAgreement(r0, r1);
    console.log(`[YT AI] Sponsor agreement: ${Math.round(agreement * 100)}%`);

    let results = [r0, r1];

    // If low agreement, add 3rd tiebreaker call
    if (agreement < 0.5) {
      console.log('[YT AI] Sponsor detection: low agreement, running tiebreaker call…');
      const r2 = await GROQ.callSponsor(apiKey, transcriptJson, model);
      results.push(r2);
      console.log('[YT AI] Tiebreaker result:', r2.length);
    }

    const segments = majorityVote(results);

    // Save to cache
    const c = loadCache();
    c[videoId] = segments;
    const keys = Object.keys(c);
    if (keys.length > SPONSOR_CACHE_MAX) {
      keys.slice(0, keys.length - SPONSOR_CACHE_MAX).forEach(k => delete c[k]);
    }
    saveCache(c);

    console.log(`[YT AI] Sponsor detection: ${segments.length} confirmed segment(s) after majority vote (${results.length} calls)`);
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
  let _currentSeekbarObserver = null;

  const getProgressBar = () => doc.querySelector('.ytp-progress-bar');

  const paintSeekbarSegments = async (segments, duration, fmtTimeFn, _retryCount = 0, onObserverCreated = null) => {
    removeSeekbarOverlay();
    if (!segments?.length || !duration) return null;

    const bar = getProgressBar();
    if (!bar) {
      // Retry after delay (max 5 retries)
      if (_retryCount < 5) {
        await new Promise(r => setTimeout(r, 1500));
        return paintSeekbarSegments(segments, duration, fmtTimeFn, _retryCount + 1, onObserverCreated);
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
    _currentSeekbarObserver = attachSeekbarObserver(bar, segments, duration, fmtTimeFn, onObserverCreated);
    
    // Notify caller about the observer (even on retry)
    if (onObserverCreated) {
      onObserverCreated(_currentSeekbarObserver);
    }
    
    return _currentSeekbarObserver;
  };

  const removeSeekbarOverlay = () => {
    doc.getElementById('ytai-segment-overlay')?.remove();
  };

  const attachSeekbarObserver = (bar, segments, duration, fmtTimeFn, onObserverCreated = null) => {
    const observer = new MutationObserver(() => {
      if (!doc.getElementById('ytai-segment-overlay') && segments.length) {
        // Disconnect this observer to prevent duplicate triggers
        observer.disconnect();
        // Recreate overlay with same params, propagate observer reference
        setTimeout(() => paintSeekbarSegments(segments, duration, fmtTimeFn, 0, onObserverCreated), 300);
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
    computeAgreement,
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
