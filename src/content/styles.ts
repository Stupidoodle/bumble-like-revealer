// The dossier HUD stylesheet, injected once as a scoped <style> (no manifest
// change). Every rule is namespaced under #be-dossier / #be-lightbox /
// #be-dossier-scrim / #be-vote-badge so nothing leaks into Bumble's own DOM.

const STYLE_ID = "be-dossier-style";

const CSS = `
/* Bumble Enhancer dossier HUD. z-index band: #be-dossier 2147483000 sits
   one below 32-bit signed INT_MAX (2147483647). #be-lightbox 2147483001 is
   above the rail; #be-dossier-scrim 2147482999 is below it. */
#be-dossier,#be-dossier *,#be-lightbox,#be-lightbox *,#be-dossier-scrim{box-sizing:border-box;}
#be-dossier{
  --be-honey:#F6B23C;--be-honey-12:rgba(246,178,60,0.12);--be-honey-20:rgba(246,178,60,0.20);--be-honey-line:rgba(246,178,60,0.55);
  --be-online:#45D27A;--be-online-glow:rgba(69,210,122,0.45);
  --be-glass:rgba(13,14,17,0.72);--be-glass-raise:rgba(20,21,25,0.66);--be-backdrop:blur(10px) saturate(118%);
  --be-edge:rgba(255,255,255,0.10);--be-line:rgba(255,255,255,0.075);--be-line-2:rgba(255,255,255,0.14);
  --be-ink:#F3F1EC;--be-ink-mute:#ADA9A0;--be-ink-faint:#8C887F;
  --be-r-xs:2px;--be-r-sm:6px;--be-r-lg:10px;
  --be-shadow:0 10px 44px rgba(0,0,0,0.55),0 2px 10px rgba(0,0,0,0.40);
  --be-sans:-apple-system,BlinkMacSystemFont,'Inter',system-ui,'Segoe UI',sans-serif;
  --be-mono:ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;
  --be-serif:'Newsreader','Iowan Old Style',Georgia,'Times New Roman',serif;
  position:fixed;top:0;right:0;height:100dvh;width:clamp(340px,30vw,400px);z-index:2147483000;
  display:none;flex-direction:column;
  background:var(--be-glass);background-image:linear-gradient(180deg,rgba(8,9,11,0.88) 0%,rgba(8,9,11,0.97) 100%);
  -webkit-backdrop-filter:var(--be-backdrop);backdrop-filter:var(--be-backdrop);
  border-left:1px solid var(--be-edge);border-top-left-radius:var(--be-r-lg);border-bottom-left-radius:var(--be-r-lg);
  box-shadow:var(--be-shadow);color:var(--be-ink);font-family:var(--be-sans);font-size:13px;line-height:1.4;
  font-variant-numeric:tabular-nums;pointer-events:none;
  transform:translateX(100%);transition:transform 220ms cubic-bezier(0.16,1,0.3,1);contain:layout style;
}
#be-dossier.be-open{transform:translateX(0);}
#be-dossier .be-header,#be-dossier .be-body,#be-dossier .be-footer{pointer-events:auto;}
#be-dossier .be-safe{position:absolute;left:0;right:0;bottom:0;height:88px;pointer-events:none;}
#be-dossier ::selection{background:var(--be-honey-20);}
#be-dossier button{font-family:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0;}
#be-dossier :focus-visible{outline:none;box-shadow:0 0 0 2px var(--be-honey-line);border-radius:var(--be-r-sm);}
/* Header */
#be-dossier .be-header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;padding:0 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-status{font:500 11px/1.2 var(--be-mono);letter-spacing:0.04em;text-transform:uppercase;color:var(--be-ink-mute);}
#be-dossier .be-status-dim{color:var(--be-honey);opacity:0.85;}
#be-dossier .be-close{width:24px;height:24px;border-radius:var(--be-r-sm);font-size:14px;color:var(--be-ink-mute);display:flex;align-items:center;justify-content:center;}
#be-dossier .be-close:hover{color:var(--be-ink);background:rgba(255,255,255,0.06);}
/* Hero */
#be-dossier .be-hero{padding:14px 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-hero-top{display:flex;gap:12px;align-items:flex-start;}
#be-dossier .be-hero-photo{width:72px;height:72px;flex:0 0 72px;border-radius:var(--be-r-sm);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.10);background:var(--be-glass-raise);}
#be-dossier .be-hero-photo img{width:100%;height:100%;object-fit:cover;display:block;}
#be-dossier .be-hero-photo-empty{width:100%;height:100%;background:linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01));}
#be-dossier .be-hero-verdict{flex:1 1 auto;min-width:0;}
#be-dossier .be-verdict-wrap{display:inline-flex;flex-direction:column;}
#be-dossier .be-verdict{display:inline-flex;align-items:center;font:700 13px/1.1 var(--be-sans);letter-spacing:0.10em;text-transform:uppercase;padding:3px 8px;border-radius:var(--be-r-sm);align-self:flex-start;}
#be-dossier .be-v-liked{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-v-match{color:#1a1206;background:var(--be-honey);}
#be-dossier .be-v-new{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);background:transparent;}
#be-dossier .be-v-passed{color:var(--be-ink-mute);opacity:0.85;}
#be-dossier .be-verdict-underline{display:block;height:1px;width:0;background:var(--be-honey-line);margin-top:3px;transition:width 320ms ease;}
#be-dossier .be-verdict-underline.be-wipe{width:100%;}
#be-dossier .be-hero-sub{margin-top:6px;}
#be-dossier .be-myvote{font:500 11px/1.2 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-hero-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
#be-dossier .be-hero-score{flex:0 0 auto;text-align:right;min-width:84px;}
#be-dossier .be-score-row{display:flex;align-items:baseline;justify-content:flex-end;gap:3px;}
#be-dossier .be-score-fig{font:600 44px/0.9 var(--be-mono);letter-spacing:-0.02em;color:var(--be-ink);}
#be-dossier .be-score-liked .be-score-fig,#be-dossier .be-score-match .be-score-fig{color:var(--be-honey);}
#be-dossier .be-score-passed .be-score-fig{color:var(--be-ink-mute);}
#be-dossier .be-score-unit{font:500 12px/1 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-score-meter{display:block;height:2px;width:100%;background:rgba(255,255,255,0.08);border-radius:var(--be-r-xs);margin-top:6px;overflow:hidden;}
#be-dossier .be-score-fill{display:block;height:100%;width:0;background:var(--be-honey-line);transition:width 900ms ease-out;}
#be-dossier .be-match-quote{margin-top:12px;font:italic 400 14px/1.45 var(--be-serif);color:var(--be-ink-mute);}
/* Body */
#be-dossier .be-body{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding-bottom:96px;}
#be-dossier .be-body::-webkit-scrollbar{display:none;}
#be-dossier .be-section{padding:16px 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-sec-head{font:650 10.5px/1 var(--be-sans);letter-spacing:0.16em;text-transform:uppercase;color:var(--be-ink-mute);padding-bottom:10px;margin-bottom:4px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:28px;padding:3px 0;}
#be-dossier .be-label{font:500 11px/1.3 var(--be-sans);letter-spacing:0.02em;color:var(--be-ink-mute);flex:0 0 auto;}
#be-dossier .be-val{font:500 13px/1.35 var(--be-sans);color:var(--be-ink);text-align:right;word-break:break-word;}
#be-dossier .be-val.be-mono{font-family:var(--be-mono);}
#be-dossier .be-faint{color:var(--be-ink-faint);font-weight:400;}
#be-dossier .be-row-name{align-items:baseline;}
#be-dossier .be-name{font:600 15px/1.2 var(--be-sans);color:var(--be-ink);}
#be-dossier .be-age{font:500 13px/1.2 var(--be-mono);color:var(--be-ink-mute);}
#be-dossier .be-caption{font:400 12px/1.3 var(--be-sans);color:var(--be-ink-faint);padding:2px 0 6px;}
#be-dossier .be-online-line{display:inline-flex;align-items:center;}
#be-dossier .be-dot{width:8px;height:8px;border-radius:50%;background:var(--be-online);display:inline-block;margin-right:7px;flex:0 0 8px;animation:be-pulse 2.4s ease-in-out infinite;}
#be-dossier .be-loc-primary{font:500 13px/1.4 var(--be-sans);color:var(--be-ink);padding:2px 0 6px;}
#be-dossier .be-sens,#be-dossier .be-flag-glyph{color:var(--be-honey);}
/* Chips */
#be-dossier .be-chip-row{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;}
#be-dossier .be-chip{display:inline-flex;align-items:center;font:600 11px/1 var(--be-sans);letter-spacing:0.02em;padding:3px 8px;border-radius:var(--be-r-sm);white-space:nowrap;}
#be-dossier .be-chip-outline{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-chip-honey{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-chip-seal{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
/* Copy */
#be-dossier .be-copy{font:500 12px/1.3 var(--be-mono);color:var(--be-ink);text-align:right;border-radius:var(--be-r-sm);padding:2px 4px;}
#be-dossier .be-copy:hover{background:rgba(255,255,255,0.05);}
#be-dossier .be-copied{color:var(--be-honey);}
/* Accordion */
#be-dossier .be-acc{border-top:1px solid var(--be-line);}
#be-dossier .be-acc:first-child{border-top:none;}
#be-dossier .be-acc-head{display:flex;align-items:center;width:100%;gap:8px;padding:10px 0;text-align:left;}
#be-dossier .be-acc-title{font:600 12px/1 var(--be-sans);color:var(--be-ink);flex:1 1 auto;}
#be-dossier .be-acc-summary{font:500 11px/1 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-chev{font-size:14px;color:var(--be-ink-mute);transition:transform 180ms ease;}
#be-dossier .be-acc-head.be-open .be-chev{transform:rotate(90deg);}
#be-dossier .be-acc-body{display:none;padding-bottom:6px;}
#be-dossier .be-acc-body.be-open{display:block;}
#be-dossier .be-acc-inner>*{margin-top:2px;}
#be-dossier .be-pull{font:400 15px/1.5 var(--be-serif);color:var(--be-ink);white-space:pre-wrap;padding:2px 0 10px;}
#be-dossier .be-prompt{display:flex;flex-direction:column;gap:4px;padding:10px 12px;margin:4px 0 10px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-prompt-tag{font:700 10px/1 var(--be-sans);letter-spacing:0.14em;color:var(--be-honey);}
#be-dossier .be-prompt-txt{font:italic 400 14px/1.45 var(--be-serif);color:var(--be-ink);}
#be-dossier .be-sub{padding:6px 0;}
#be-dossier .be-sub-head{font:650 10px/1 var(--be-sans);letter-spacing:0.14em;text-transform:uppercase;color:var(--be-ink-faint);padding:6px 0 4px;}
#be-dossier .be-exp{font:500 13px/1.4 var(--be-sans);color:var(--be-ink);padding:3px 0;}
#be-dossier .be-track{display:flex;align-items:center;gap:8px;padding:3px 0;}
#be-dossier .be-track-txt{font:500 13px/1.35 var(--be-sans);color:var(--be-ink);}
#be-dossier .be-play{color:var(--be-honey);font-size:13px;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--be-honey-line);display:flex;align-items:center;justify-content:center;flex:0 0 22px;}
/* Flag matrix */
#be-dossier .be-flag-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;}
#be-dossier .be-flag{display:inline-flex;align-items:center;font:550 10.5px/1 var(--be-mono);letter-spacing:0.02em;color:var(--be-ink-mute);padding:4px 8px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-line-2);}
#be-dossier .be-flag-on{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
/* Filmstrip */
#be-dossier .be-media-cap{font:500 11px/1 var(--be-mono);color:var(--be-ink-mute);padding:2px 0 10px;}
#be-dossier .be-filmstrip{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;}
#be-dossier .be-filmstrip::-webkit-scrollbar{display:none;}
#be-dossier .be-thumb{position:relative;width:56px;height:72px;flex:0 0 56px;border-radius:var(--be-r-sm);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.10);}
#be-dossier .be-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
#be-dossier .be-thumb-vid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-size:14px;text-shadow:0 1px 4px rgba(0,0,0,0.7);}
/* States */
#be-dossier .be-empty{padding:48px 16px;text-align:center;color:var(--be-ink-faint);font:400 13px/1.4 var(--be-sans);}
#be-dossier .be-error{padding:16px;}
#be-dossier .be-retry{font:500 12px/1.4 var(--be-mono);color:var(--be-honey);text-align:left;padding:8px 10px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-honey-line);width:100%;}
#be-dossier .be-sk{background:linear-gradient(90deg,rgba(246,178,60,0.06) 25%,rgba(246,178,60,0.14) 50%,rgba(246,178,60,0.06) 75%);background-size:400px 100%;animation:be-shimmer 1.2s linear infinite;border-radius:var(--be-r-sm);height:10px;}
#be-dossier .be-sk-head{width:38%;height:9px;margin-bottom:14px;}
#be-dossier .be-sk-row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;}
#be-dossier .be-sk-label{flex:0 0 28%;}
#be-dossier .be-sk-val{flex:0 0 40%;}
/* Footer */
#be-dossier .be-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:36px;padding:0 16px;border-top:1px solid var(--be-line);background:var(--be-glass-raise);padding-bottom:max(0px,env(safe-area-inset-bottom));}
#be-dossier .be-cache{font:500 11px/1.2 var(--be-mono);color:var(--be-ink-mute);}
#be-dossier .be-refetch{width:24px;height:24px;border-radius:var(--be-r-sm);color:var(--be-honey);font-size:14px;display:flex;align-items:center;justify-content:center;}
#be-dossier .be-refetch:hover{background:var(--be-honey-12);}
#be-dossier .be-safe-note{font:500 10px/1 var(--be-mono);color:var(--be-ink-faint);letter-spacing:0.04em;}
/* Stagger */
#be-dossier .be-stagger{opacity:0;transform:translateY(6px);transition:opacity 240ms ease,transform 240ms cubic-bezier(0.16,1,0.3,1);}
#be-dossier .be-stagger.be-in{opacity:1;transform:none;}
/* Scrim (narrow viewports) */
#be-dossier-scrim{position:fixed;inset:0;z-index:2147482999;background:rgba(6,7,9,0.55);display:none;pointer-events:auto;-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px);}
#be-dossier-scrim.be-show{display:block;}
/* Lightbox */
#be-lightbox{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;pointer-events:auto;}
#be-lightbox .be-lb-scrim{position:absolute;inset:0;background:rgba(6,7,9,0.86);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
#be-lightbox .be-lb-img{position:relative;max-width:88vw;max-height:88vh;border-radius:var(--be-r-lg,10px);box-shadow:0 10px 44px rgba(0,0,0,0.6);object-fit:contain;}
#be-lightbox button{position:relative;background:rgba(20,21,25,0.66);color:#F3F1EC;border:none;cursor:pointer;border-radius:50%;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
#be-lightbox button:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(246,178,60,0.55);}
#be-lightbox .be-lb-close{position:absolute;top:18px;right:18px;width:36px;height:36px;font-size:16px;}
#be-lightbox .be-lb-prev,#be-lightbox .be-lb-next{width:44px;height:44px;font-size:22px;margin:0 10px;}
/* Armed badge (lives in Bumble's DOM; only our id is targeted) */
#be-vote-badge.be-badge--armed{border-radius:6px;padding:1px 6px;background:rgba(8,9,11,0.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);transition:background 140ms ease,box-shadow 140ms ease;}
#be-vote-badge.be-badge--armed:hover{background:rgba(246,178,60,0.12);box-shadow:inset 0 0 0 1px rgba(246,178,60,0.55);}
#be-vote-badge.be-badge--armed:hover::after{content:' \\2318 D';font-size:10px;opacity:0.7;font-family:ui-monospace,Menlo,monospace;}
/* Animations */
@keyframes be-pulse{0%,100%{box-shadow:0 0 0 0 var(--be-online-glow);}50%{box-shadow:0 0 0 4px rgba(69,210,122,0);}}
@keyframes be-shimmer{0%{background-position:-200px 0;}100%{background-position:200px 0;}}
/* Reduced motion: collapse all motion to instant and drop GPU backdrop blur */
#be-dossier.be-rm,#be-dossier.be-rm *{transition:none !important;animation:none !important;}
#be-dossier.be-rm{-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}
@media (prefers-reduced-motion: reduce){
  #be-dossier,#be-dossier *,#be-vote-badge.be-badge--armed{transition:none !important;animation:none !important;}
  #be-dossier .be-dot{animation:none !important;}
  #be-dossier,#be-dossier-scrim,#be-lightbox .be-lb-scrim,#be-lightbox button,#be-vote-badge.be-badge--armed{-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}
}
/* Narrow viewports: the scrim already blurs, so drop the rail's backdrop blur
   to avoid two stacked blurred layers over the animating deck. The raised
   opaque gradient fill keeps text contrast (AA) without it. */
@media (max-width:1179px){
  #be-dossier{-webkit-backdrop-filter:none;backdrop-filter:none;}
}
`;

export const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
};
