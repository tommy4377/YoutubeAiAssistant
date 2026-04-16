     // ==UserScript==
     // @name         YouTube Transcript & AI Assistant
     // @namespace    http://tampermonkey.net/
     // @version      5.1
     // @description  Transcript + Groq AI (Llama) + Gemini Review. Modular architecture with Player API fetch, live sync, markdown export, language settings, AI-powered sponsor/ad auto-skip with Groq+Gemini review, seekbar overlay.
     // @author       tommy437
     // @match        https://www.youtube.com/*
     // @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
     // @grant        GM_setValue
     // @grant        GM_getValue
     // @grant        GM_xmlhttpRequest
     // @grant        GM_addStyle
     // @grant        unsafeWindow
     // @connect      api.groq.com
     // @connect      generativelanguage.googleapis.com
     // @connect      www.youtube.com
     // @connect      googlevideo.com
     // @connect      *.googlevideo.com
     // @noframes
     // @run-at       document-start
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/constants.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/styles.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/transcript.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/groq.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/gemini.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/sponsor.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/ui.js?v=27
     // @require      https://raw.githubusercontent.com/tommy4377/YoutubeAiAssistant/refs/heads/main/modules/main.js?v=27
     // ==/UserScript==

     // All logic loaded via @require modules. See /modules/ directory for source.
     console.log('[YT AI] YouTube Transcript & AI Assistant v5.1 loader initialized');
