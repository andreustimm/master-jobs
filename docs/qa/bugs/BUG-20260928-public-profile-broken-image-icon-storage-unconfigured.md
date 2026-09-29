# BUG-20260928-public-profile-broken-image-icon-storage-unconfigured: perfil público mostra ícone de imagem quebrada (em vez de nada) quando o armazenamento fica sem configuração

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Visitante do perfil público
- **Journey Step:** J-open-public-profile, variante publicada com foto/capa opt-in
- **Scenarios:** PUB-public-photo-cover-opt-in
- **Found:** 2026-09-28 · **Report:** docs/qa/reports/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted.md

## Summary

Quando o candidato já tem foto e/ou capa salvas e com "Mostrar no perfil
público" ligado, e o ambiente **deixa de ter `JHO_STORAGE_DRIVER` configurado**
(por exemplo, uma reconfiguração de ambiente que remova a variável), o perfil
público (`/p/<endereço>`), visível a qualquer visitante anônimo, passa a
mostrar o ícone de imagem quebrada do navegador no lugar da foto e da capa —
em vez de simplesmente omitir a imagem, como acontece quando o próprio
candidato desliga "Mostrar no perfil público" manualmente. O texto da PR
promete que, sem armazenamento configurado, "`/candidate` diz que o envio não
está configurado e `/p/` sai sem imagem" — mas o `/p/` observado aqui sai
**com ícone de imagem quebrada**, não sem imagem.

Isto é diferente do caminho feliz de "desligar mostrar", que omite a imagem
por completo, sem nenhum vestígio visual — comportamento correto e já
confirmado nesta mesma rodada. O caso aqui é apenas quando o registro no
banco continua dizendo "mostrar = true" e a chave de imagem existe, mas o
armazenamento por trás não está acessível.

## Reproduction

- **Charter:** CH-photo-cover-visitor-desktop · **Tour:** Feature Tour
- **Environment:** desktop (1280×900), en, endereço público
  `qa-foto-capa-v2`, com foto e capa já salvas e "Mostrar no perfil público"
  ligado nas duas; servidor reiniciado **sem** `JHO_STORAGE_DRIVER` (nem
  `S3_*`)

1. Com foto e capa salvas e visíveis (confirmado com `JHO_STORAGE_DRIVER=s3`
   configurado), reiniciar o servidor sem nenhuma variável de armazenamento.
2. Abrir `/p/qa-foto-capa-v2` numa janela anônima (sem sessão).

**Expected:** Segundo a PR, "`/p/` sai sem imagem" — ou seja, o layout deveria
se comportar como quando "Mostrar" está desligado: sem foto, sem capa, sem
nenhum espaço vazio ou ícone quebrado.

**Actual:** A página carrega normalmente (200), mas tanto a capa quanto a foto
aparecem como ícone de imagem quebrada do navegador (a requisição para
`/p/qa-foto-capa-v2/image/photo` e `.../image/cover` responde 404, e o
`<img>` não tem nenhum tratamento de erro/fallback visível).

## Evidence

- `docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/BUG-broken-icon-storage-unconfigured-visitor-head21724ef.png` — reconfirmado no HEAD `21724ef` (depois das correções de revisão L2 da PR, commits `a8bca20`..`21724ef`, que mudaram o teto para 4 MB e não tocaram este caminho): perfil público em janela anônima, pt-BR, tema escuro, servidor sem `JHO_STORAGE_DRIVER`, mostrando os dois ícones de imagem quebrada (capa e foto, com alt "Foto do perfil") ao lado de "Perfil sem nome".
- `docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/BUG-broken-icon-storage-unconfigured-visitor.png` — primeira reprodução (commit `ef8d359`), mesmo sintoma, em inglês/tema claro, ao lado de "Unnamed profile".
- `docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-not-configured-candidate-card.png` — o mesmo problema visível também em `/candidate` (ícone quebrado no lugar da prévia da foto), antes mesmo de qualquer nova tentativa de envio.
- Confirmado por `curl` sem cookie, nos dois commits testados: `GET /p/qa-foto-capa-v2` → 200; `GET /p/qa-foto-capa-v2/image/photo?v=...` e `.../image/cover?v=...` → 404. A mensagem "Image upload is not configured in this environment." aparece corretamente ao **tentar enviar** uma nova imagem em `/candidate` (isso funciona como esperado) — o problema é só a exibição passiva de uma imagem que já existia.

## Fix

<!-- não corrigido nesta rodada — instrução da tarefa foi registrar e reportar, não corrigir -->

## Verification

<!-- pendente -->
