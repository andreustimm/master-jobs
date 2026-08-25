import { en } from "../i18n/en.ts";
import { LOCALE_COOKIE } from "../i18n/locales.ts";
import { ptBR } from "../i18n/pt-BR.ts";
import {
  SPLASH_BRAND_CLASS,
  SPLASH_ICON_CLASS,
  SPLASH_ICON_SIZE,
  SPLASH_ICON_SRC,
  SPLASH_NAME_CLASS,
  SPLASH_PRODUCT_NAME,
  SPLASH_PROGRESS_CLASS,
} from "./splash.ts";

export type OfflineCopy = {
  title: string;
  body: string;
  retry: string;
};

export type OfflineEditions = {
  "pt-BR": OfflineCopy;
  en: OfflineCopy;
};

export const OFFLINE_DOCUMENT_PATH = "/offline.html";

export const OFFLINE_EDITIONS: OfflineEditions = {
  "pt-BR": {
    title: ptBR.transition.offlineTitle,
    body: ptBR.transition.offlineBody,
    retry: ptBR.transition.retry,
  },
  en: {
    title: en.transition.offlineTitle,
    body: en.transition.offlineBody,
    retry: en.transition.retry,
  },
};

export function escapeOfflineText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function renderBrand(): string {
  return `<div class="${SPLASH_BRAND_CLASS}" aria-hidden="true">
<img class="${SPLASH_ICON_CLASS}" src="${escapeOfflineText(SPLASH_ICON_SRC)}" alt="" width="${SPLASH_ICON_SIZE}" height="${SPLASH_ICON_SIZE}" decoding="async" />
<span class="${SPLASH_NAME_CLASS}">${escapeOfflineText(SPLASH_PRODUCT_NAME)}</span>
</div>
<div class="${SPLASH_PROGRESS_CLASS}" aria-hidden="true"><span></span></div>`;
}

function renderEdition(locale: keyof OfflineEditions, copy: OfflineCopy, hidden: boolean): string {
  return `<section class="offline-copy" data-offline-locale="${locale}" lang="${locale}"${hidden ? " hidden" : ""}>
<h1>${escapeOfflineText(copy.title)}</h1>
<p>${escapeOfflineText(copy.body)}</p>
<button type="button" data-offline-retry>${escapeOfflineText(copy.retry)}</button>
</section>`;
}

function renderLocaleScript(): string {
  return `(function(){try{
var supported={"pt-BR":true,"en":true};
var found=(document.cookie||"").match(new RegExp("(?:^|;\\\\s*)"+${JSON.stringify(LOCALE_COOKIE)}+"=([^;]*)"));
var saved=found?decodeURIComponent(found[1]):"";
var candidates=[];
if(supported[saved])candidates.push(saved);
var browserLanguages=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||""];
for(var i=0;i<browserLanguages.length;i++)candidates.push(browserLanguages[i]);
var locale="pt-BR";
for(var j=0;j<candidates.length;j++){
var candidate=String(candidates[j]||"").toLowerCase();
if(candidate==="pt-br"||candidate.indexOf("pt-")===0||candidate==="pt"){locale="pt-BR";break;}
if(candidate==="en"||candidate.indexOf("en-")===0){locale="en";break;}
}
document.documentElement.lang=locale;
var editions=document.querySelectorAll("[data-offline-locale]");
for(var k=0;k<editions.length;k++)editions[k].hidden=editions[k].getAttribute("data-offline-locale")!==locale;
var retries=document.querySelectorAll("[data-offline-retry]");
for(var n=0;n<retries.length;n++)retries[n].addEventListener("click",function(){location.reload();},{once:true});
}catch(e){}})();`;
}

function renderOfflineCSS(): string {
  return `:root{color-scheme:light;--background:#ffffff;--foreground:#1a1a1a;--primary:#024ad8;--primary-foreground:#ffffff;--muted:#636363;--border:#c2c2c2;--spacing-xs:8px;--spacing-sm:12px;--spacing-md:16px;--spacing-xl:24px;--radius-md:4px}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--background:#101215;--foreground:#ffffff;--primary:#296ef9;--primary-foreground:#ffffff;--muted:#c2c2c2;--border:#636363}}
*{box-sizing:border-box}
html,body{min-block-size:100%;margin:0;background:var(--background);color:var(--foreground);font-family:Inter,Arial,sans-serif}
body{min-block-size:100dvh;display:grid;place-items:center;padding:max(var(--spacing-xl),env(safe-area-inset-top)) max(var(--spacing-md),env(safe-area-inset-right)) max(var(--spacing-xl),env(safe-area-inset-bottom)) max(var(--spacing-md),env(safe-area-inset-left));overflow-wrap:anywhere}
main{inline-size:min(100%,34rem);display:flex;flex-direction:column;align-items:center;gap:var(--spacing-xl);text-align:center}
.${SPLASH_BRAND_CLASS}{display:flex;flex-direction:column;align-items:center;gap:var(--spacing-sm);animation:offline-enter 420ms ease-out both}
.${SPLASH_ICON_CLASS}{inline-size:72px;block-size:72px;border-radius:16px;display:block}
.${SPLASH_NAME_CLASS}{font-family:ui-monospace,SFMono-Regular,"IBM Plex Mono",monospace;font-size:15px;font-weight:500;letter-spacing:-.01em;opacity:.85}
.${SPLASH_PROGRESS_CLASS}{position:relative;inline-size:120px;block-size:2px;border-radius:2px;overflow:hidden;background:color-mix(in oklab,currentColor 12%,transparent)}
.${SPLASH_PROGRESS_CLASS} span{position:absolute;inset-block:0;inset-inline-start:0;inline-size:40%;border-radius:inherit;background:currentColor;opacity:.55;animation:offline-sweep 1.1s ease-in-out infinite}
.offline-copy{inline-size:100%;display:flex;flex-direction:column;align-items:center;gap:var(--spacing-md)}
.offline-copy[hidden]{display:none}
h1{margin:0;font-size:20px;font-weight:500;line-height:1}
p{max-inline-size:34rem;margin:0;color:var(--muted);font-size:16px;line-height:1.4}
button{min-block-size:44px;margin-block-start:var(--spacing-xs);padding:var(--spacing-sm) var(--spacing-xl);border:0;border-radius:var(--radius-md);background:var(--primary);color:var(--primary-foreground);font:600 14px/1.4 Inter,Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase;cursor:pointer}
button:focus-visible{outline:2px solid var(--foreground);outline-offset:2px}
@keyframes offline-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes offline-sweep{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
@media (prefers-reduced-motion:reduce){.${SPLASH_BRAND_CLASS},.${SPLASH_PROGRESS_CLASS} span{animation:none}.${SPLASH_PROGRESS_CLASS} span{inline-size:100%;opacity:.3}*{scroll-behavior:auto!important;transition:none!important}}`;
}

export function renderOfflineDocument(editions: OfflineEditions = OFFLINE_EDITIONS): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" />
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#101215" media="(prefers-color-scheme: dark)" />
<title>${escapeOfflineText(editions["pt-BR"].title)} · ${escapeOfflineText(SPLASH_PRODUCT_NAME)}</title>
<style>${renderOfflineCSS()}</style>
</head>
<body>
<main aria-labelledby="offline-title">
${renderBrand()}
<div id="offline-title" role="status" aria-live="polite" aria-atomic="true">
${renderEdition("pt-BR", editions["pt-BR"], false)}
${renderEdition("en", editions.en, true)}
</div>
</main>
<script>${renderLocaleScript()}</script>
</body>
</html>
`;
}
