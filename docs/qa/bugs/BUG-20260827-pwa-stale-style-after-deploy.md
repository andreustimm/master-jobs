# BUG-20260827-pwa-stale-style-after-deploy: PWA aberta mantém o visual antigo depois do deploy

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Candidato em trânsito
- **Journey Step:** J-open-dashboard-direct — Abrir o dashboard diretamente, step 3
- **Scenarios:** PWA-installed-update-current
- **Found:** 2026-08-27 · **Report:** docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md

## Summary

Ao voltar para uma PWA que permaneceu aberta durante um deploy, o usuário continua vendo o CSS da geração anterior. No iOS observado, relógio, sinal e bateria ficam sobre a marca e os controles. A mesma versão aberta como página web já está correta.

Este defeito é distinto de `BUG-20260826-responsive-header-artifact-skew`: aquele combinava HTML e CSS incompatíveis no artefato servido; este mantém no documento já aberto os estilos válidos, porém antigos, mesmo depois que um worker novo assume o cliente.

## Reproduction

- **Charter:** CH-installed-pwa-update-resume · **Tour:** Interrupt Tour
- **Environment:** PWA instalada no iPhone, retrato, pt-BR; aplicação mantida entre gerações publicadas

1. Abrir a PWA instalada em uma geração anterior e deixá-la aberta ou em segundo plano.
2. Publicar uma geração com CSS novo.
3. Voltar à PWA sem limpar caches nem reinstalar.

**Expected:** A PWA detecta a geração nova, recarrega uma única vez e passa a usar o CSS atual, com o topo cobrindo a viewport inteira e os controles protegidos da barra do sistema.
**Actual:** O worker novo pode assumir o cliente, mas o documento permanece carregado com os estilos antigos até uma recarga manual.

## Evidence

- `docs/qa/evidence/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh/pwa-installed-stale-header-user-report.jpg` — captura fornecida pelo usuário em 2026-08-27.
- Uma sessão nova em produção recebeu `/sw.js` com `Cache-Control: public, max-age=0, must-revalidate`, marca `1.3.8+160744c`, worker ativo sem geração em espera e somente os caches `static-1.3.8+160744c` e `shell-1.3.8+160744c`; isso isolou o defeito ao documento instalado que já estava aberto.

## Fix

- **Root cause:** o registro não pedia uma atualização ao retomar o aplicativo e não escutava `controllerchange`. `skipWaiting()` e `clients.claim()` trocavam o controlador, mas não substituíam o documento e o CSS já carregados.
- **Fix commit:** `8d55f90`
- **Regression test:** `tests/service-worker-update.test.ts` falhou antes e passa depois, cobrindo `updateViaCache: "none"`, atualização ao voltar ao primeiro plano, uma única recarga ao trocar o controlador e ausência de recarga na primeira instalação. `tests/e2e/ui.mjs` confirma que a geração atual mede o topo de borda a borda em retrato, paisagem, tablet e desktop.

## Verification

- **Retested:** aguardando a publicação em staging/produção, mesma PWA instalada e mesma jornada · **Report:** docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
- **Result:** bloqueado até uma geração posterior assumir uma PWA que já estava aberta.
