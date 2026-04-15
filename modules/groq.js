// groq.js - YouTube AI Assistant v5.0 - AI/Groq API Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  const UTILS = window.YTAI?.UTILS;

  if (!CONSTANTS || !UTILS) {
    console.error('[YTAI Groq] Dependencies missing. Ensure constants.js is loaded first.');
    return;
  }

  const { GROQ_URL, LANGUAGES, SVG } = CONSTANTS;
  const { selectGroqModel } = UTILS;

  // ───────────────────────────────────────────────────────────────────────────
  // Request Queue with 2s minimum gap (prevents rate limit 429s)
  // ───────────────────────────────────────────────────────────────────────────
  let _lastCallTime = 0;
  const _callQueue = [];
  let _isProcessingQueue = false;

  const MIN_CALL_GAP_MS = 2000; // 2 seconds between requests

  const processQueue = async () => {
    if (_isProcessingQueue) return;
    _isProcessingQueue = true;

    while (_callQueue.length > 0) {
      const { options, resolve, reject } = _callQueue.shift();

      // Enforce minimum gap between calls
      const now = Date.now();
      const timeSinceLastCall = now - _lastCallTime;
      if (timeSinceLastCall < MIN_CALL_GAP_MS) {
        await new Promise(r => setTimeout(r, MIN_CALL_GAP_MS - timeSinceLastCall));
      }
      _lastCallTime = Date.now();

      // Execute the actual request
      try {
        const result = await executeRequest(options);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }

    _isProcessingQueue = false;
  };

  const executeRequest = (options) => new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest === 'undefined') {
      reject(new Error('GM_xmlhttpRequest not available'));
      return;
    }
    GM_xmlhttpRequest({
      timeout: 90000, // 90 second timeout for AI inference
      ...options,
      onload: resolve,
      onerror: reject,
      ontimeout: reject,
    });
  });

  const request = (options) => new Promise((resolve, reject) => {
    _callQueue.push({ options, resolve, reject });
    processQueue();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Prompt Builders
  // ───────────────────────────────────────────────────────────────────────────
  const buildSummaryPrompt = (channelName, slValue, transcriptLen) => {
    const langObj = LANGUAGES.find(l => l.value === slValue);
    const langInstr = (!slValue || slValue === 'native' || !langObj?.aiName)
      ? 'LANGUAGE RULE: Detect the language of the transcript and write your ENTIRE response in that same language. Never translate to English unless the transcript is in English.'
      : `LANGUAGE RULE: Write the response in ${langObj.aiName}, but keep JSON keys exactly as keypoints and summary.`;

    const pointsRule = transcriptLen < 5000
      ? 'Provide exactly 4 to 5 key points. Summary: 1 well-developed paragraph.'
      : transcriptLen < 15000
        ? 'Provide exactly 6 to 8 key points. Summary: 2 detailed paragraphs minimum.'
        : 'Provide exactly 9 to 12 key points. Summary: 3+ detailed paragraphs covering all major topics.';

    return `You are an expert video content analyst. Your task is to analyze a YouTube transcript and produce a JSON object.

${langInstr}

## STRICT JSON FORMAT
Return ONLY a raw JSON object — no markdown fences, no preamble, no trailing text.
Required structure:
{
  "keypoints": ["string", "string", ...],
  "summary": "string"
}

## KEY POINTS RULES
${pointsRule}
- Each point MUST be SPECIFIC: include names, numbers, dates, or concrete details from the video.
  ✗ BAD:  "The speaker discusses the importance of nutrition."
  ✓ GOOD: "Reducing processed sugar intake by 30g/day improved focus scores by 22% in the 8-week study cited."
- Each key point MUST NOT exceed 20 words. No compound sentences. One idea per bullet.
- Each point must be a complete, self-contained sentence.
- You MUST bold at least 1 term per key point using **double asterisks** around key concepts, statistics, product names, or pivotal conclusions.
  ✗ Do NOT bold: generic adjectives ("important", "key"), articles, prepositions.
  ✓ DO bold: "**NEAT** (Non-Exercise Activity Thermogenesis) accounts for up to **350 calories/day**."

## SUMMARY RULES
- Must be SIGNIFICANTLY longer and more detailed than the key_points list combined.
- Must synthesize ideas, show connections between concepts, and add context not captured in the key points.
- Must NOT simply repeat the key points in paragraph form.
- Use **bold** for the same categories as key_points.
- Do NOT mention the channel name "${channelName}" unless it is directly relevant to understanding the content.

## CONTENT FRAMING
- For educational, science, or history videos: focus on facts and subject matter; use "The video explains…" or "The lesson covers…"
- For vlogs, opinions, or personal content: you may refer to "${channelName}" when contextually appropriate.`;
  };

  const buildSponsorPrompt = () => `You are a YouTube video content analyzer. Given a transcript as an array of {t: seconds, s: text} objects, identify all non-content segments including:
- Sponsored/ad reads by the presenter (type: "sponsor")
- Self-promotion (channel, Patreon, merch, social links) (type: "self_promo")
- Engagement calls ("like, subscribe, comment") (type: "engagement")

Return ONLY a raw JSON object in this exact format:
{"segments": [{"start": 123, "end": 187, "label": "Sponsor name or description", "type": "sponsor"}]}

If no such segments are found, return: {"segments": []}

Rules:
- "start" and "end" must be integers (seconds).
- "end" uses the timestamp of the last sentence in the segment + estimated duration (5–15s).
- "type" must be exactly one of: "sponsor", "self_promo", "engagement".
- "label" should be the sponsor/product name if identifiable, otherwise the type description.
- Return valid JSON only. No explanation, no markdown.`;

  // ───────────────────────────────────────────────────────────────────────────
  // Summary Generation (single call, no retry)
  // ───────────────────────────────────────────────────────────────────────────
  const callSummary = async (apiKey, transcriptText, channelName, slValue) => {
    const model = selectGroqModel(transcriptText.length);
    const systemPrompt = buildSummaryPrompt(channelName, slValue, transcriptText.length);

    const res = await request({
      method: 'POST',
      url: GROQ_URL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript from YouTube channel "${channelName}":\n\n${transcriptText}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.25,
        max_completion_tokens: 2048,
        stream: false,
      }),
    });

    // 429 — throw with status so caller can detect and retry
    if (res.status === 429) {
      const err = new Error('Rate limit exceeded');
      err.status = 429;
      err.retryAfter = parseInt((res.responseHeaders || '').match(/retry-after:\s*(\d+)/i)?.[1] || '60');
      throw err;
    }

    // Other HTTP errors
    if (res.status >= 400) {
      throw new Error(`Groq API error: HTTP ${res.status} ${res.statusText || ''}`);
    }

    const resp = JSON.parse(res.responseText);
    if (resp.error) {
      throw new Error(resp.error.message || 'Groq API error');
    }

    const raw = resp.choices?.[0]?.message?.content || '';
    let j = parseJSON(raw);

    // Fallback parsing if standard JSON parse fails
    if (!j) {
      const sumMatch = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      const kpBlock = raw.match(/"keypoints"\s*:\s*\[([\s\S]*?)\]/);
      if (sumMatch && kpBlock) {
        j = { summary: sumMatch[1].replace(/\\n/g, ' '), keypoints: [] };
        for (const mm of kpBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
          j.keypoints.push(mm[1]);
        }
      }
    }

    const normalized = normalizeResponse(j);
    if (!normalized.keypoints.length) {
      console.error('[YT AI] Raw Groq response:', raw);
      throw new Error('Could not parse AI response. See console for details.');
    }

    return {
      keypoints: normalized.keypoints,
      summary: normalized.summary,
      model,
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Sponsor Detection (Single Call)
  // ───────────────────────────────────────────────────────────────────────────
  const callSponsor = async (apiKey, transcriptJson, model) => {
    try {
      const res = await request({
        method: 'POST',
        url: GROQ_URL,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        data: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildSponsorPrompt() },
            { role: 'user', content: transcriptJson },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_completion_tokens: 256, // Reduced from 512 - sponsor JSON is short
          stream: false,
        }),
      });

      // 429 — throw so caller can handle (don't cache empty results)
      if (res.status === 429) {
        const err = new Error('Rate limit exceeded');
        err.status = 429;
        err.retryAfter = parseInt((res.responseHeaders || '').match(/retry-after:\s*(\d+)/i)?.[1] || '60');
        throw err;
      }

      const resp = JSON.parse(res.responseText);
      if (resp.error) return [];

      const raw = resp.choices?.[0]?.message?.content || '';
      const j = JSON.parse(raw);
      const segs = Array.isArray(j?.segments) ? j.segments : [];

      return segs.filter(s =>
        typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start
      );
    } catch (e) {
      console.warn('[YT AI] Sponsor detection call failed:', e);
      return [];
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // JSON Parsing (Robust)
  // ───────────────────────────────────────────────────────────────────────────
  const parseJSON = (text) => {
    if (!text) return null;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1) return null;

    let clean = text.slice(first, last + 1);
    try {
      return JSON.parse(clean);
    } catch (_) { /* continue */ }

    try {
      clean = clean.replace(/[\r\n]/g, '\\n').replace(/\t/g, '\\t');
      return JSON.parse(clean);
    } catch (_) { /* continue */ }

    try {
      const fallback = JSON.parse(clean.replace(/[\r\n]/g, ' ').replace(/\s+/g, ' '));
      if (!fallback) return null;

      if (!fallback.keypoints && Array.isArray(fallback.key_points)) fallback.keypoints = fallback.key_points;
      if (!fallback.keypoints && Array.isArray(fallback.punti_chiave)) fallback.keypoints = fallback.punti_chiave;
      if (!fallback.keypoints && Array.isArray(fallback.points)) fallback.keypoints = fallback.points;
      if (!fallback.summary && typeof fallback.riassunto === 'string') fallback.summary = fallback.riassunto;
      if (!fallback.summary && typeof fallback.sintesi === 'string') fallback.summary = fallback.sintesi;

      return fallback;
    } catch (_) {
      return null;
    }
  };

  const normalizeResponse = (j) => ({
    keypoints: Array.isArray(j?.keypoints)
      ? j.keypoints
      : Array.isArray(j?.key_points)
        ? j.key_points
        : Array.isArray(j?.punti_chiave)
          ? j.punti_chiave
          : [],
    summary: j?.summary || j?.riassunto || j?.sintesi || '',
  });

  // ───────────────────────────────────────────────────────────────────────────
  // UI-Aware Summary Call (owns ALL retry logic)
  // ───────────────────────────────────────────────────────────────────────────
  const callSummaryWithUI = async (apiKey, transcriptText, channelName, slValue, setBodyFn) => {
    const MAX_ATTEMPTS = 3;
    const MAX_429_RETRIES = 2; // Max rate-limit countdowns allowed
    let attempt = 0;
    let retries429 = 0;

    while (attempt < MAX_ATTEMPTS) {
      setBodyFn(`<div class="ytai-loading">${SVG.sparkles}<span>Analysing with AI${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}…</span></div>`);

      try {
        return await callSummary(apiKey, transcriptText, channelName, slValue);
      } catch (e) {
        // Rate limit: show countdown then retry (limited retries)
        if (e.status === 429) {
          if (retries429 < MAX_429_RETRIES) {
            retries429++;
            const delay = Math.min(e.retryAfter || 60, 90);
            for (let i = delay; i > 0; i--) {
              setBodyFn(`<div class="ytai-retry-bar">Rate limit — retrying in ${i}s…</div>`);
              await new Promise(r => setTimeout(r, 1000));
            }
            continue;
          }
          throw e; // no more 429 retries left
        }

        // Other errors: count toward attempt budget
        attempt++;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, attempt * 5000));
          continue;
        }
        // Exhausted retries
        throw e;
      }
    }
    // Should never reach here, but explicit error for clarity (Bug 11 fix)
    throw new Error('Max attempts exceeded');
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.GROQ = {
    callSummary,
    callSummaryWithUI,
    callSponsor,
    buildSummaryPrompt,
    buildSponsorPrompt,
    parseJSON,
    normalizeResponse,
    request,
  };
})();
