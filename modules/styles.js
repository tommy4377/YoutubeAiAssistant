// styles.js - YouTube AI Assistant v5.0 - Styles Module
(function () {
  'use strict';

  const CONSTANTS = window.YTAI?.CONSTANTS;
  if (!CONSTANTS) {
    console.error('[YTAI Styles] YTAI.CONSTANTS not loaded. Ensure constants.js is required before styles.js');
    return;
  }

  const { WIDGET_ID, C } = CONSTANTS;  // SEG_COLORS removed - applied inline in sponsor.js

  // ───────────────────────────────────────────────────────────────────────────
  // CSS Injection
  // ───────────────────────────────────────────────────────────────────────────
  let _injected = false;  // Guard against multiple inject() calls
  const inject = () => {
    if (_injected) return;
    _injected = true;
    GM_addStyle(`
      #${WIDGET_ID} {
        background:${C.bgCard};
        border-radius:12px;
        border:1px solid ${C.borderSoft};
        margin-bottom:16px;
        font-family:Roboto,'YouTube Sans',Arial,sans-serif;
        color:${C.text};
        overflow:hidden;
        display:flex;
        flex-direction:column;
        height:500px;
        max-height:calc(100vh - 120px);  /* Responsive cap for small screens */
        width:100%;
        box-sizing:border-box;
        box-shadow:0 1px 2px rgba(0,0,0,.6),0 4px 12px rgba(0,0,0,.3);
        z-index:2000;
      }
      .ytai-header {
        display:flex;
        border-bottom:1px solid ${C.borderSoft};
        background:${C.bgHeader};
        flex-shrink:0;
      }
      .ytai-tab {
        flex:1;
        text-align:center;
        padding:12px 0;
        cursor:pointer;
        font-size:13px;
        font-weight:500;
        color:${C.muted};
        text-transform:uppercase;
        letter-spacing:.5px;
        border-bottom:2px solid transparent;
        transition:color .15s,border-bottom-color .15s;
        user-select:none;
      }
      .ytai-tab:hover { color:${C.text}; }
      .ytai-tab.active { color:${C.text}; border-bottom-color:${C.text}; }
      .ytai-body {
        flex:1;
        overflow-y:auto;
        scrollbar-width:thin;
        scrollbar-color:rgba(255,255,255,.2) transparent;
        padding:6px 0;
      }
      .ytai-body::-webkit-scrollbar { width:4px; }
      .ytai-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,.2); border-radius:2px; }
      .ytai-body--setup {
        overflow:hidden;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:0;
      }
      .ytai-setup {
        display:flex;
        flex-direction:column;
        align-items:center;
        text-align:center;
        padding:24px 28px;
        width:100%;
      }
      .ytai-setup-icon {
        width:60px;
        height:60px;
        background:rgba(255,255,255,.06);
        border-radius:50%;
        display:flex;
        align-items:center;
        justify-content:center;
        margin-bottom:14px;
      }
      .ytai-setup h3 { margin:0 0 6px; font-size:16px; font-weight:500; color:${C.text}; }
      .ytai-setup p { margin:0 0 20px; font-size:13px; color:${C.muted}; line-height:1.5; max-width:280px; }
      .ytai-setup hr { width:100%; max-width:300px; border:none; border-top:1px solid ${C.borderSoft}; margin:0 0 14px; }
      .ytai-setup a { font-size:12px; color:${C.accent}; text-decoration:none; opacity:.8; transition:opacity .15s; }
      .ytai-setup a:hover { opacity:1; }
      .ytai-setup-section { width:100%; max-width:300px; }
      .ytai-setup-section h3 { margin:0 0 6px; font-size:15px; font-weight:500; color:${C.text}; }
      .ytai-setup-section p { margin:0 0 12px; font-size:12px; color:${C.muted}; line-height:1.5; }
      .ytai-input {
        width:100%;
        max-width:300px;
        background:${C.bgInput};
        border:1px solid rgba(255,255,255,.2);
        border-radius:4px;
        color:${C.text};
        font-size:14px;
        font-family:Roboto,Arial,sans-serif;
        padding:10px 14px;
        outline:none;
        box-sizing:border-box;
        margin-bottom:12px;
        transition:border-color .15s;
      }
      .ytai-input:focus { border-color:${C.accent}; }
      .ytai-input::placeholder { color:rgba(255,255,255,.3); }
      .ytai-select {
        width:100%;
        background:${C.bgInput};
        border:1px solid rgba(255,255,255,.2);
        border-radius:4px;
        color:${C.text};
        font-size:13px;
        font-family:Roboto,Arial,sans-serif;
        padding:8px 12px;
        outline:none;
        box-sizing:border-box;
        cursor:pointer;
        appearance:none;
        -webkit-appearance:none;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23aaaaaa'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat:no-repeat;
        background-position:right 10px center;
        padding-right:30px;
        transition:border-color .15s;
      }
      .ytai-select:focus { border-color:${C.accent}; }
      .ytai-select option { background:#2a2a2a; color:${C.text}; }
      .ytai-btn-primary {
        background:${C.text};
        border:none;
        border-radius:18px;
        color:#0f0f0f;
        cursor:pointer;
        font-size:13px;
        font-family:Roboto,Arial,sans-serif;
        font-weight:500;
        padding:8px 20px;
        transition:background .15s;
        white-space:nowrap;
      }
      .ytai-btn-primary:hover { background:#d9d9d9; }
      .ytai-btn-danger {
        background:transparent;
        border:1px solid ${C.error};
        border-radius:18px;
        color:${C.error};
        cursor:pointer;
        font-size:13px;
        font-family:Roboto,Arial,sans-serif;
        font-weight:500;
        padding:7px 20px;
        transition:background .15s,color .15s;
        white-space:nowrap;
      }
      .ytai-btn-danger:hover { background:rgba(255,82,82,.1); }
      .ytai-line {
        display:flex;
        align-items:flex-start;
        padding:8px 20px 8px 16px;
        cursor:pointer;
        border-left:3px solid transparent;
        transition:background .12s,border-left-color .12s;
      }
      .ytai-line:hover { background:${C.bgHover}; }
      .ytai-line.active-click { background:${C.bgActive}; }
      .ytai-line.active-sync { background:${C.bgActive}; border-left-color:${C.accent}; }
      .ytai-ts {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:13px;
        font-family:'Roboto Mono','Courier New',monospace;
        font-weight:700;
        color:${C.muted};
        background:rgba(255,255,255,.08);
        border-radius:4px;
        min-width:68px;
        padding:3px 10px;
        margin-right:16px;
        margin-top:2px;
        flex-shrink:0;
        letter-spacing:.4px;
        user-select:none;
        white-space:nowrap;
        transition:background .12s,color .12s;
      }
      .ytai-line:hover .ytai-ts,
      .ytai-line.active-sync .ytai-ts,
      .ytai-line.active-click .ytai-ts {
        background:rgba(62,166,255,.2);
        color:${C.accent};
      }
      .ytai-txt {
        font-size:14px;
        line-height:1.6;
        color:${C.textSoft};
        word-break:break-word;
        unicode-bidi:plaintext;
      }
      .ytai-line.active-sync .ytai-txt { color:${C.text}; }
      .ytai-toolbar {
        display:flex;
        justify-content:flex-end;
        align-items:center;
        gap:2px;
        padding:6px 8px;
        border-top:1px solid ${C.borderSoft};
        background:${C.bgHeader};
        flex-shrink:0;
      }
      .ytai-btn {
        display:flex;
        align-items:center;
        gap:5px;
        background:transparent;
        border:none;
        color:${C.muted};
        cursor:pointer;
        padding:5px 10px;
        border-radius:18px;
        font-size:12px;
        font-family:Roboto,Arial,sans-serif;
        font-weight:500;
        white-space:nowrap;
        transition:background .15s,color .15s;
      }
      .ytai-btn:hover { background:rgba(255,255,255,.1); color:${C.text}; }
      .ytai-btn.on { color:${C.text}; }
      .ytai-btn.ok { color:${C.success}; }
      .ytai-btn[hidden] { display:none !important; }
      .ytai-loading {
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        height:100%;
        gap:12px;
        color:${C.muted};
        font-size:14px;
      }
      .ytai-error {
        padding:24px 20px;
        color:${C.error};
        text-align:center;
        font-size:13px;
        line-height:1.7;
      }
      .ytai-error a { color:${C.accent}; text-decoration:underline; cursor:pointer; }
      .ytai-error small { color:${C.muted}; }
      .ytai-summary { padding:16px 20px 28px; }
      .ytai-section {
        display:flex;
        align-items:center;
        gap:8px;
        color:${C.accent};
        font-size:12px;
        font-weight:700;
        text-transform:uppercase;
        letter-spacing:.6px;
        margin:0 0 12px;
        padding-bottom:8px;
        border-bottom:1px solid ${C.borderSoft};
      }
      .ytai-section:not(:first-child) { margin-top:20px; }
      .ytai-summary ul { margin:0; padding:0; list-style:none; }
      .ytai-summary li {
        font-size:14px;
        color:${C.textSoft};
        line-height:1.6;
        margin-bottom:9px;
        padding-left:16px;
        position:relative;
      }
      .ytai-summary li::before {
        content:'';
        position:absolute;
        left:1px;
        top:10px;
        width:5px;
        height:5px;
        background:rgba(255,255,255,.3);
        border-radius:50%;
      }
      .ytai-summary p { font-size:14px; color:${C.textSoft}; line-height:1.75; margin:0; }
      .ytai-summary strong { color:${C.text}; font-weight:600; }
      .ytai-settings { padding:16px 20px 24px; }
      .ytai-settings-section { margin-bottom:24px; }
      .ytai-settings-section:last-child { margin-bottom:0; }
      .ytai-settings-header {
        display:flex;
        align-items:center;
        gap:8px;
        color:${C.accent};
        font-size:11px;
        font-weight:700;
        text-transform:uppercase;
        letter-spacing:.6px;
        margin-bottom:12px;
        padding-bottom:8px;
        border-bottom:1px solid ${C.borderSoft};
      }
      .ytai-settings-row {
        display:flex;
        flex-direction:column;
        gap:6px;
        margin-bottom:12px;
      }
      .ytai-settings-row:last-child { margin-bottom:0; }
      .ytai-settings-label { font-size:13px; color:${C.text}; font-weight:500; }
      .ytai-settings-desc { font-size:12px; color:${C.muted}; line-height:1.4; margin-bottom:6px; }
      .ytai-key-row { display:flex; gap:8px; align-items:center; }
      .ytai-key-row .ytai-input { flex:1; max-width:none; margin-bottom:0; font-size:13px; padding:8px 12px; }
      .ytai-key-status { display:flex; align-items:center; gap:6px; font-size:12px; margin-top:6px; }
      .ytai-key-status.connected { color:${C.success}; }
      .ytai-key-status.disconnected { color:${C.muted}; }
      .ytai-status-dot { width:7px; height:7px; border-radius:50%; display:inline-block; flex-shrink:0; }
      .connected .ytai-status-dot { background:${C.success}; box-shadow:0 0 4px ${C.success}; }
      .disconnected .ytai-status-dot { background:${C.muted}; }
      .ytai-save-feedback {
        display:inline-flex;
        align-items:center;
        gap:4px;
        font-size:12px;
        color:${C.success};
        opacity:0;
        transition:opacity .2s;
        margin-left:4px;
      }
      .ytai-save-feedback.show { opacity:1; }
      .ytai-retry-bar {
        display:flex;
        align-items:center;
        justify-content:center;
        gap:8px;
        font-size:13px;
        color:${C.warning};
        padding:12px 16px;
        background:rgba(255,183,77,.07);
        border-radius:8px;
        margin:16px 20px 0;
      }
      .ytai-method-badge {
        font-size:11px;
        color:${C.muted};
        text-align:right;
        padding:4px 20px 2px;
        font-family:monospace;
        opacity:.55;
        user-select:none;
      }
      #ytai-skip-toast {
        position:fixed;
        bottom:80px;
        right:20px;
        z-index:9999;
        background:${C.bgHeader};
        color:${C.text};
        font-size:13px;
        font-family:Roboto,Arial,sans-serif;
        padding:10px 16px;
        border-radius:8px;
        border:1px solid ${C.borderSoft};
        box-shadow:0 4px 16px rgba(0,0,0,.5);
        pointer-events:none;
        animation:ytai-toast-in .15s ease;
      }
      @keyframes ytai-toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      .ytai-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .ytai-toggle { position:relative; width:36px; height:20px; flex-shrink:0; }
      .ytai-toggle input { opacity:0; width:0; height:0; }
      .ytai-toggle-slider {
        position:absolute;
        inset:0;
        background:rgba(255,255,255,.15);
        border-radius:20px;
        cursor:pointer;
        transition:background .2s;
      }
      .ytai-toggle-slider::before {
        content:'';
        position:absolute;
        width:14px;
        height:14px;
        left:3px;
        top:3px;
        background:${C.muted};
        border-radius:50%;
        transition:.2s;
      }
      .ytai-toggle input:checked + .ytai-toggle-slider { background:${C.accent}; }
      .ytai-toggle input:checked + .ytai-toggle-slider::before { transform:translateX(16px); background:#fff; }
      .ytai-sponsor-segments { list-style:none; margin:8px 0 0; padding:0; }
      .ytai-sponsor-segments li {
        font-size:12px;
        color:${C.textSoft};
        padding:4px 0;
        border-bottom:1px solid ${C.borderSoft};
        display:flex;
        align-items:center;
        gap:6px;
      }
      .ytai-sponsor-segments li:last-child { border-bottom:none; }
      .ytai-sponsor-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
      #ytai-segment-overlay { position:absolute; inset:0; pointer-events:none; z-index:50; }
      .ytai-seg-bar { position:absolute; top:0; height:100%; opacity:.85; }
    `);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Exports
  // ───────────────────────────────────────────────────────────────────────────
  window.YTAI = window.YTAI || {};
  window.YTAI.STYLES = { inject };
})();
