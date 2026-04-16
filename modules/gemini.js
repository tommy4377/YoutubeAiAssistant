// gemini.js - YouTube AI Assistant v5.0 - Gemini API Review Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  const UTILS = window.YTAI?.UTILS;

  if (!CONSTANTS || !UTILS) {
    console.error('[YTAI Gemini] Dependencies missing. Ensure constants.js is loaded first.');
    return;
  }

  const { GEMINI_URL, GEMINI_MODEL, SVG } = CONSTANTS;
  const { setHTML } = UTILS;

  // ───────────────────────────────────────────────────────────────────────────
  // Raw GM Request Helper (avoids async onload anti-pattern)
  // ───────────────────────────────────────────────────────────────────────────
  const _gmPost = (options) => new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest === 'undefined') {
      reject(new Error('GM_xmlhttpRequest not available'));
      return;
    }
    GM_xmlhttpRequest({
      ...options,
      onload: resolve,
      onerror: reject,
      ontimeout: reject
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Gemini API Request Wrapper
  // ───────────────────────────────────────────────────────────────────────────
  const callGemini = async (apiKey, systemInstruction, userContent) => {
    const MAX_RETRIES = 2;
    let attempt = 0;

    const data = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: userContent }] }
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    });

    while (attempt <= MAX_RETRIES) {
      const res = await _gmPost({
        method: 'POST',
        url: `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`,
        headers: {
          'Content-Type': 'application/json'
        },
        data,
        timeout: 60000
      });

      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) {
          const err = new Error('Gemini rate limit exceeded');
          err.status = 429;
          err.retryAfter = parseInt((res.responseHeaders || '').match(/retry-after:\s*(\d+)/i)?.[1] || '10');
          throw err;
        }
        const delay = Math.min(parseInt((res.responseHeaders || '').match(/retry-after:\s*(\d+)/i)?.[1] || '10'), 60) * 1000;
        console.warn(`[YT AI] Gemini call rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s…`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }

      if (res.status >= 400) {
        throw new Error(`Gemini API error: HTTP ${res.status}`);
      }

      try {
        const resp = JSON.parse(res.responseText);
        return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (e) {
        throw new Error('Failed to parse Gemini response');
      }
    }

    throw new Error('Max retries exceeded');
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Prompt Builders
  // ───────────────────────────────────────────────────────────────────────────
  const buildSummaryReviewPrompt = () => `You are an expert editor reviewing an AI-generated video summary. Your task is to improve the quality of the key points and summary.

REVIEW CRITERIA:
- Key points: Are they specific? Do they include concrete details (names, numbers, dates)? Are they concise (≤20 words each)?
- Bold formatting: Is at least 1 key term bolded per key point using **double asterisks**? Remove excessive bold. Add bold to important terms that are missing it.
- Summary: Is it detailed enough? Does it synthesize ideas rather than just listing them? Is it well-written?
- Language: Is the response in the correct language? Fix any grammar or style issues.
- Quantity: Adjust the number of key points if needed (too few = add important missing points; too many = merge or remove weak ones).

RULES:
- Output ONLY a raw JSON object with keys "keypoints" (array of strings) and "summary" (string). No markdown, no explanation.
- Keep all valid content. Only ADD detail, FIX issues, or IMPROVE phrasing. Do NOT remove important information.
- If the original is already excellent, return it unchanged (or with minor polish).
- Maintain the same language as the input.
- Each key point must be a complete sentence, ≤20 words, with at least one **bolded term**. Example: "**Segmentation fault** occurs when a program accesses memory it doesn't own."

INPUT FORMAT:
You will receive the AI's raw output containing keypoints and summary. Review and improve it, then output your reviewed JSON.`;

  const buildSponsorReviewPrompt = () => `You are reviewing sponsor/non-content segments detected in a YouTube video transcript. Given the candidate segments and surrounding transcript context, validate and correct them.

TASK:
1. For each candidate segment: verify it is truly a sponsor read, self-promotion, or engagement call using the transcript context provided. Remove false positives.
2. Adjust start/end timestamps if they are inaccurate (use the context timestamps as reference).
3. Add any missed segments that should have been detected (only if clearly present in the context).
4. Correct labels if wrong (e.g., a segment labeled "sponsor" that is actually "self_promo").

INPUT FORMAT:
- Candidates: JSON array of {start, end, label, type}
- Context: transcript lines around each segment with timestamps in format [{t: seconds, s: text}]

OUTPUT FORMAT:
Return ONLY a raw JSON object: {"segments": [{start, end, label, type}]}
- "start" and "end" must be integers (seconds from the original transcript timestamps)
- "type" must be exactly one of: "sponsor", "self_promo", "engagement"
- "label" should be the sponsor/product name if identifiable, otherwise the type description
- If no valid segments remain, return: {"segments": []}

RULES:
- No explanation, no markdown. Just the JSON.
- Use the context timestamps to determine accurate start/end boundaries.
- Look for transitions like "this video is sponsored by", "check out my Patreon", "don't forget to like and subscribe".`;

  // ───────────────────────────────────────────────────────────────────────────
  // Summary Review
  // ───────────────────────────────────────────────────────────────────────────
  const reviewSummary = async (apiKey, groqResult) => {
    const { keypoints, summary, model } = groqResult;

    const userContent = JSON.stringify({
      original_keypoints: keypoints,
      original_summary: summary,
      groq_model: model
    }, null, 2);

    const responseText = await callGemini(
      apiKey,
      buildSummaryReviewPrompt(),
      userContent
    );

    // Parse Gemini's JSON response
    const j = parseGeminiJSON(responseText);
    if (!j || !Array.isArray(j.keypoints)) {
      console.warn('[YT AI] Gemini summary review returned invalid JSON, using Groq result');
      return groqResult;
    }

    return {
      keypoints: j.keypoints,
      summary: j.summary || summary,
      model: `${model} → gemini-reviewed`
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Sponsor Review
  // ───────────────────────────────────────────────────────────────────────────
  const reviewSponsors = async (apiKey, groqSegments, transcriptData) => {
    if (!groqSegments?.length) return [];

    // Build context for each segment (20s before, 10s after)
    const context = buildSegmentContext(groqSegments, transcriptData);

    const userContent = JSON.stringify({
      candidates: groqSegments,
      context: context
    }, null, 2);

    const responseText = await callGemini(
      apiKey,
      buildSponsorReviewPrompt(),
      userContent
    );

    const j = parseGeminiJSON(responseText);
    if (!j || !Array.isArray(j.segments)) {
      console.warn('[YT AI] Gemini sponsor review returned invalid JSON, using Groq result');
      return groqSegments;
    }

    return j.segments.filter(s =>
      typeof s.start === 'number' &&
      typeof s.end === 'number' &&
      s.end > s.start &&
      ['sponsor', 'self_promo', 'engagement'].includes(s.type)
    );
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Context Builder for Sponsor Review
  // ───────────────────────────────────────────────────────────────────────────
  const buildSegmentContext = (segments, transcriptData) => {
    const context = [];

    for (const seg of segments) {
      const startWindow = seg.start - 20;
      const endWindow = seg.end + 10;

      const relevantLines = transcriptData.filter(l =>
        l.start >= startWindow && l.start <= endWindow
      );

      context.push({
        segment_start: seg.start,
        segment_end: seg.end,
        window_start: startWindow,
        window_end: endWindow,
        transcript_lines: relevantLines.map(l => ({ t: Math.round(l.start), s: l.text }))
      });
    }

    return context;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // JSON Parsing (Robust)
  // ───────────────────────────────────────────────────────────────────────────
  const parseGeminiJSON = (text) => {
    if (!text) return null;

    // Remove markdown fences if present
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();

    try {
      return JSON.parse(clean);
    } catch (_) { /* continue */ }

    // Try to extract JSON object from text
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first === -1 || last === -1) return null;

    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch (_) { /* continue */ }

    // Try cleaning newlines
    try {
      return JSON.parse(clean.replace(/[\r\n]/g, ' ').replace(/\s{2,}/g, ' '));
    } catch (_) {
      return null;
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.GEMINI = {
    callGemini,
    reviewSummary,
    reviewSponsors,
    buildSummaryReviewPrompt,
    buildSponsorReviewPrompt,
    parseGeminiJSON,
    buildSegmentContext
  };
})();
