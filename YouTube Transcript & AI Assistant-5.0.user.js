// ==UserScript==
// @name         YouTube Transcript & AI Assistant
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Transcript + Groq AI (Llama). Modular architecture with Player API fetch, live sync, markdown export, language settings, AI-powered sponsor/ad auto-skip with triple-check, seekbar overlay.
// @author       tommy437
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      api.groq.com
// @connect      www.youtube.com
// @connect      googlevideo.com
// @noframes
// @run-at       document-start
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/constants.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/styles.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/transcript.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/groq.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/sponsor.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/ui.js
// @require      file:///Users/tommy/Documents/youtubeUtility/modules/main.js
// ==/UserScript==

// All logic loaded via @require modules. See /modules/ directory for source.
console.log('[YT AI] YouTube Transcript & AI Assistant v5.0 loader initialized');
