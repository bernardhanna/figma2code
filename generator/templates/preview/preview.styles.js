// generator/templates/preview/preview.styles.js

export function previewCss({ bodyFontCss, designW }) {
  return `
${bodyFontCss}

.overlay-toolbar{
  position: relative;
  top: 0;
  z-index: 60;
  backdrop-filter: blur(8px);
  background: rgba(255,255,255,.86);
  border-bottom: 1px solid rgba(0,0,0,.08);
}

/* --- Viewport toolbar --- */
.vpbar{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.vpbtn{
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,.12);
  background: #fff;
  cursor: pointer;
  user-select:none;
}
.vpbtn[data-active="1"]{
  background:#0f172a;
  color:#fff;
  border-color: rgba(15,23,42,.3);
}
.vpmeta{ font-size: 12px; color: rgba(15,23,42,.75); white-space: nowrap; }
.vptrack{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.vprail{
  position:relative;
  height: 10px;
  width: 220px;
  border-radius: 999px;
  background: rgba(15,23,42,.10);
  border: 1px solid rgba(0,0,0,.08);
  cursor: ew-resize;
  user-select:none;
}
.vpthumb{
  position:absolute;
  top: 50%;
  transform: translate(-50%,-50%);
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background:#0f172a;
  box-shadow: 0 8px 20px rgba(0,0,0,.16);
}
.vprail:active .vpthumb{ transform: translate(-50%,-50%) scale(1.05); }

/* --- Non-scaling device frame wrapper --- */
.preview-stage{
  width: 100%;
  display:flex;
  justify-content:center;
  padding: 16px 12px 40px;
}

.device-frame{
  transform: none !important;
  zoom: 1 !important;

  width: var(--vpw, ${designW}px);
  max-width: min(100%, var(--design-w, ${designW}px));
  background: #fff;
  position: relative;
}

.device-frame-inner{ width: 100%; }

.device-outline{
  border: 1px solid rgba(0,0,0,.08);
  box-shadow: 0 14px 38px rgba(0,0,0,.10);
  overflow: hidden;
}

#cmp_root{
  position: relative;
  width: 100%;
  height: var(--cmp-h, auto);

 max-width: var(--vpw, ${designW}px);
  margin-left: auto;
  margin-right: auto;

  overflow: hidden;
}


.bg-layer{
  position:absolute;
  inset:0;
  z-index:0;
  pointer-events:none;
  overflow:hidden;
}
.bg-layer img{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  display:block;
  object-fit: var(--bg-fit, cover);
  object-position: var(--bg-pos, center);
}

.content-layer{
  position:relative;
  z-index:10;
  width:100%;
}

/* replace ONLY the .overlay-img block in preview.styles.js with this */

.overlay-img{
  position: absolute;
  top: 0;

  /* Center the overlay when it's narrower than the viewport */
  left: 50%;
  transform: translateX(-50%);

  /* Fill available width, but never exceed the active overlay design width */
  width: 100%;
  height: auto;

  max-width: min(
    var(--vpw, ${designW}px),
    var(--overlay-w, var(--design-w, ${designW}px))
  );

  pointer-events: none;

  /* Defaults (JS also sets inline styles for reliability) */
  opacity: var(--oop, 0.5);
  mix-blend-mode: var(--obm, normal);

  z-index: 40;
}


.overlay-hidden{ display: none; }

/* --- Score modal --- */
.modal-backdrop{
  position:fixed;
  inset:0;
  background:rgba(15,23,42,.45);
  backdrop-filter: blur(4px);
  display:none;
  z-index: 1000;
  align-items:center;
  justify-content:center;
  padding: 24px;
}
.modal-backdrop[data-open="1"]{ display:flex; }

.modal{
  width: min(920px, 100%);
  background:#fff;
  border-radius:16px;
  box-shadow: 0 20px 60px rgba(0,0,0,.22);
  border: 1px solid rgba(0,0,0,.08);
  overflow:hidden;
}
.modal-hd{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(0,0,0,.08);
  background: rgba(248,250,252,.9);
}
.modal-title{ font-size: 14px; font-weight: 700; color:#0f172a; }
.modal-sub{ font-size: 12px; color: rgba(15,23,42,.7); margin-top: 2px; }
.modal-bd{ padding: 16px 18px; }
.pill{
  display:inline-flex;
  align-items:center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,.12);
  background: #fff;
  color:#0f172a;
  font-weight: 600;
}
.pill[data-kind="pass"]{ border-color: rgba(16,185,129,.35); background: rgba(16,185,129,.10); }
.pill[data-kind="fail"]{ border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.10); }

.grid{ display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px){ .grid{ grid-template-columns: 1fr; } }
.card{
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 14px;
  padding: 12px 12px;
  background: #fff;
}
.k{ font-size: 11px; color: rgba(15,23,42,.65); text-transform: uppercase; letter-spacing: .06em; }
.v{ margin-top: 4px; font-size: 13px; color:#0f172a; font-weight: 600; }
.mono{ font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }

.modal-ft{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid rgba(0,0,0,.08);
  background: rgba(248,250,252,.9);
  flex-wrap: wrap;
}
.btn2{
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,.12);
  background: #fff;
  cursor:pointer;
}
.btn2:hover{ background: rgba(241,245,249,.8); }
.btn2.primary{
  background: #0f172a;
  color:#fff;
  border-color: rgba(15,23,42,.3);
}
.btn2.primary:hover{ background:#111c33; }

.links a{
  font-size: 12px;
  color:#0f172a;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity:.9;
  margin-right: 10px;
  white-space: nowrap;
}
`;
}
