// transcript.js - YouTube AI Assistant v5.0 - Transcript Fetching Module
(function () {
  'use strict';

  const UTILS = window.YTAI?.UTILS;
  const CONSTANTS = window.YTAI?.CONSTANTS;

  if (!UTILS || !CONSTANTS) {
    console.error('[YTAI Transcript] Dependencies missing. Ensure constants.js is loaded first.');
    return;
  }

  const { win, doc } = UTILS;
  const { LANGUAGES } = CONSTANTS;

  // ───────────────────────────────────────────────────────────────────────────
  // Unified GM_xmlhttpRequest helper (bypasses YouTube page-level rate limits)
  // ───────────────────────────────────────────────────────────────────────────
  const gmRequest = (method, url, body = null) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      data: body,
      responseType: 'text',
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          try {
            const json = JSON.parse(res.responseText);
            resolve(json);
          } catch (e) {
            resolve(res.responseText);
          }
        } else {
          console.warn(`[YT AI] HTTP ${res.status} from ${url.slice(0, 60)}...`);
          reject(new Error(`HTTP ${res.status}`));
        }
      },
      onerror: () => reject(new Error('Network error')),
      ontimeout: () => reject(new Error('Request timed out')),
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Method A: Player API (Primary)
  // ───────────────────────────────────────────────────────────────────────────
  const fetchPlayerAPI = async (videoId, tLang) => {
    const ytcfg = win.ytcfg;
    const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY');

    if (!apiKey) {
      throw new Error('API key not found in ytcfg');
    }

    const androidContext = {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
      },
    };

    let playerData;
    try {
      const url = `https://www.youtube.com/youtubei/v1/player${apiKey ? `?key=${apiKey}` : ''}`;
      const body = JSON.stringify({
        context: androidContext,
        videoId: videoId,
      });
      playerData = await gmRequest('POST', url, body);
    } catch (e) {
      throw new Error(`Player API request failed: ${e.message}`);
    }

    const captions = playerData?.captions?.playerCaptionsTracklistRenderer;
    if (!captions || !Array.isArray(captions.captionTracks) || !captions.captionTracks.length) {
      throw new Error('Subtitles not available (no captionTrack in Android API response)');
    }

    const tracks = captions.captionTracks;
    let targetTrack = null;

    if (tLang !== 'native') {
      // 1. Exact language code match
      targetTrack = tracks.find(t => t.languageCode === tLang);

      // 2. Regional code match (e.g. ar → ar-MA, ar-SA; ja → ja-JP)
      if (!targetTrack) {
        targetTrack = tracks.find(t => t.languageCode?.startsWith(tLang + '-'));
      }

      // 3. Match on yt_text field (native script) or English label
      if (!targetTrack) {
        const langObj = LANGUAGES.find(l => l.value === tLang);
        const ytText = (langObj?.yt_text || '').toLowerCase();
        const aiLabel = (langObj?.label || '').toLowerCase();
        targetTrack = tracks.find(t => {
          const simpleText = (t.name?.simpleText || '').toLowerCase();
          return (ytText && simpleText.includes(ytText)) ||
            (aiLabel && simpleText.includes(aiLabel));
        });
      }

      // 4. Use YouTube translation (tlang) for machine-translated captions
      if (!targetTrack) {
        const base = tracks.find(t => t.languageCode === 'en' && t.isTranslatable && t.baseUrl)
                   || tracks.find(t => t.isTranslatable && t.baseUrl)
                   || tracks.find(t => t.baseUrl);
        if (base) {
          targetTrack = { ...base, baseUrl: base.baseUrl + `&tlang=${encodeURIComponent(tLang)}` };
          console.log(`[YT AI] Using translation: ${base.languageCode} → ${tLang}`);
        }
      }
    }

    if (!targetTrack) targetTrack = tracks.find(t => t.languageCode === 'en');
    if (!targetTrack) targetTrack = tracks[0];

    // Ensure selected track has a baseUrl (Bug 6 fix)
    if (!targetTrack?.baseUrl) {
      // Try to find any track with a baseUrl
      const fallbackTrack = tracks.find(t => t.baseUrl);
      if (fallbackTrack) {
        targetTrack = fallbackTrack;
      } else {
        throw new Error('No caption track with subtitle URL available');
      }
    }

    console.log(`[YT AI] Track selected: ${targetTrack.name?.simpleText || targetTrack.languageCode} (lang pref: ${tLang})`);

    const subtitleUrl = targetTrack.baseUrl.replace('&fmt=srv3', '');

    // Graceful fallback: if translation (&tlang=) fails, retry without it
    const urlsToTry = [subtitleUrl];
    if (subtitleUrl.includes('&tlang=')) {
      urlsToTry.push(subtitleUrl.replace(/&tlang=[^&]+/, ''));
    }

    // Use unified GM helper to bypass YouTube's page-level rate limiting
    let rawText;
    let lastError;
    for (const url of urlsToTry) {
      try {
        rawText = await gmRequest('GET', url);
        if (url !== urlsToTry[0]) {
          console.log('[YT AI] Translation failed, fell back to native track');
        }
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!rawText) throw lastError || new Error('Subtitle fetch failed');

    return parseTimedText(rawText);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Parse Timed Text (XML → segments)
  // ───────────────────────────────────────────────────────────────────────────
  const parseTimedText = (rawText) => {
    const data = [];
    const re = /<text\b[^>]*\bstart="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;

    const decodeHTML = (t) => t
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    let m;
    while ((m = re.exec(rawText)) !== null) {
      const start = parseFloat(m[1]) || 0;
      let text = m[2];
      text = decodeHTML(decodeHTML(text));
      text = text
        .replace(/<[^>]+>/g, '')
        .replace(/>>+/g, '')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (text) data.push({ start, text });
    }

    if (!data.length) {
      console.warn('[YT AI] Raw subtitle response (first 300):', rawText.slice(0, 300));
      throw new Error('Could not parse subtitle response (XML)');
    }

    return data;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Method B: DOM Panel (Fallback)
  // ───────────────────────────────────────────────────────────────────────────
  const fetchDOM = async (waitForFn, attempt = 1) => {
    const MAX = 4;
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, attempt * 1200));
    }

    let container = doc.querySelector('#segments-container ytd-transcript-segment-renderer,ytd-transcript-body-renderer ytd-transcript-segment-renderer')
      ? doc.querySelector('#segments-container, ytd-transcript-body-renderer')
      : null;

    if (!container) {
      const btn = await waitForFn(() => (
        doc.querySelector('ytd-video-description-transcript-section-renderer button') ||
        doc.querySelector('button[aria-label*="transcript" i]') ||
        doc.querySelector('button[aria-label*="trascrizione" i]')
      ), 10000);

      if (!btn) throw new Error('Transcript button not found');
      btn.click();
      await new Promise(r => setTimeout(r, 800));

      container = await waitForFn(() => {
        const c = doc.querySelector('#segments-container');
        if (c?.querySelector('ytd-transcript-segment-renderer')) return c;
        const b = doc.querySelector('ytd-transcript-body-renderer');
        if (b?.querySelector('ytd-transcript-segment-renderer')) return b;
        return null;
      }, 10000);
    }

    if (!container) {
      if (attempt < MAX) return fetchDOM(waitForFn, attempt + 1);
      throw new Error('Transcript panel did not load — the video may not have CC subtitles');
    }

    const segs = Array.from(container.querySelectorAll('ytd-transcript-segment-renderer'));
    if (!segs.length) {
      if (attempt < MAX) return fetchDOM(waitForFn, attempt + 1);
      throw new Error('No segment elements found');
    }

    const data = parseDOMSegments(container);

    // Close transcript panel
    try {
      doc.querySelector('button[aria-label*="Close transcript" i],button[aria-label*="Chiudi" i]')?.click();
    } catch (_) { /* ignore */ }

    return data;
  };

  const parseDOMSegments = (container) => {
    const segs = Array.from(container.querySelectorAll('ytd-transcript-segment-renderer'));
    return segs.map(seg => {
      const rawTs = seg.querySelector('.segment-timestamp,[class*="timestamp"]')?.textContent?.trim() || '0:00';
      const text = seg.querySelector('.segment-text,yt-formatted-string')?.textContent?.trim() || '';
      const parts = rawTs.split(':').map(Number);
      const start = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + (parts[1] || 0);
      return { start, text };
    }).filter(l => l.text);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Orchestrator: Try Player API, fallback to DOM
  // ───────────────────────────────────────────────────────────────────────────
  const fetchTranscript = async (videoId, tLang, waitForFn) => {
    // Try Player API first
    try {
      const data = await fetchPlayerAPI(videoId, tLang);
      if (data?.length) {
        console.log(`[YT AI] ✓ Player API (${data.length} lines)`);
        return { data, method: 'player-api' };
      }
    } catch (e) {
      console.warn('[YT AI] Player API failed:', e.message);
    }

    // Fallback to DOM method
    try {
      const data = await fetchDOM(waitForFn);
      if (data?.length) {
        console.log(`[YT AI] ✓ DOM fallback (${data.length} lines)`);
        return { data, method: 'dom-fallback' };
      }
    } catch (e) {
      console.error('[YT AI] All methods failed:', e.message);
      throw e;
    }

    throw new Error('No transcript data available');
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.TRANSCRIPT = {
    fetchPlayerAPI,
    fetchDOM,
    fetchTranscript,
    parseTimedText,
    parseDOMSegments,
  };
})();
