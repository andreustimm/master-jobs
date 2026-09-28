# Perfil público, fase 3/3: campos opt-in, foto e capa

**Slug:** `perfil-publico-opt-in` · **Issue:** [#327](https://github.com/andreustimm/master-jobs/issues/327)
· **Depende de:** fase 2, #326 (layout de `/p/[slug]`, mesclado em #355)
· **Issue-mãe:** [#315](https://github.com/andreustimm/master-jobs/issues/315)
· **Tamanho:** L

A issue autoriza separar a entrega em duas partes. **Parte A** (esta PR): os
campos de texto opt-in. **Parte B** (outra PR): foto e capa, com a porta de
armazenamento no formato S3, adapter Vercel Blob em produção e adapter S3
contra MinIO local. B aparece aqui só como plano.

## Problema

Um recrutador que abre `/p/<endereço>` vê nome, headline, localização, links,
skills e (com o segundo consentimento) o currículo. As perguntas que ele faz
antes de chamar — "trabalha remoto? B2B? que nível? está procurando? quando
começa? muda de país? que idiomas?" — ficam sem resposta na tela, ou
escondidas no meio do CV. A referência escolhida pelo dono (Jobicy) responde
a essas perguntas numa faixa de fatos e num cartão "Em resumo".

O gargalo do produto é a decisão ([vision.md](../../../docs/product/vision.md)):
o recrutador decide em segundos se a conversa vale, e o candidato decide o que
expõe. Os dois lados precisam de controle explícito.

## Personas

- **Candidato** (dono do perfil): escolhe, campo a campo, o que sai em `/p/`.
- **Recrutador / visitante anônimo:** lê os fatos sem sessão, no celular.

## Objetivos

1. O candidato preenche, em `/candidate`, sete fatos: modelo de trabalho,
   nível de experiência, disponibilidade, prazo para começar, aceita mudar,
   área e idiomas.
2. Cada fato tem o próprio "mostrar no perfil público", **desligado por
   padrão**. Desligado, o fato fica guardado e não sai em lugar nenhum de
   `/p/`.
3. Ligado, o fato aparece na faixa de fatos do topo (modelo, nível,
   disponibilidade, ao lado da localização) ou no cartão "Em resumo" da
   lateral (área, idiomas, prazo, aceita mudar).
4. Nenhum fato abre a porta para contato nem para pretensão salarial.

## Regras de negócio

1. Opt-in por campo, `false` por padrão, gravado no banco (sobrevive a reload).
2. Modelo de trabalho, nível, disponibilidade e prazo são **valores
   controlados** (lista fechada, rótulo traduzido no dicionário). Aceita mudar
   é sim/não/não informado.
3. Área e idiomas são texto livre curto, com teto (recusa, não trunca).
4. Texto livre com e-mail ou telefone é recusado na gravação
   (`containsContact()`) e esvaziado na saída — a saída vale para dado gravado
   por qualquer caminho.
5. Texto livre com cara de pretensão salarial (rótulo de piso, palavra de
   remuneração perto de valor) é recusado na gravação e esvaziado na saída.
6. **Pretensão salarial nunca é campo** — nem opt-in (G21). O piso é a posição
   de negociação.
7. Perfil não público continua 404 (G22); os opt-ins só valem com
   `visibility = public`.
8. Só o próprio candidato grava, pela sessão (`guardOwnCandidate`), nunca por
   id vindo do formulário (regra 15).

## Fora de escopo da parte A

- Foto e capa (parte B, abaixo).
- Busca de candidatos por esses fatos (o recrutador não filtra por eles aqui).
- Usar os fatos no scorer: `profile.yaml` continua dono do matching; estes
  campos são apresentação.

## Parte B — plano (outra PR)

Registrado para não perder as decisões do dono de 25/09:

- Porta de armazenamento modelada na semântica S3 (bucket + key,
  `PutObject`/`GetObject`/`HeadObject`/`DeleteObject`, `ContentType`,
  `ContentLength`, metadados, ETag). Nada fora do adapter importa SDK.
- Adapter Vercel Blob (`@vercel/blob`) em produção; adapter S3
  (`@aws-sdk/client-s3`, endpoint configurável, `forcePathStyle`) com MinIO
  local, pronto para AWS S3 por configuração. Seleção por
  `JHO_STORAGE_DRIVER`, composição por função (regra 4).
- MinIO em `docker compose` com portas só em `127.0.0.1` (regra 12).
- Mesma suíte de contrato para os dois adapters.
- Credenciais em variável de ambiente, nunca em banco/log (regra 16); banco
  guarda só a key.
- Imagem servida por rota do app que confere a visibilidade (perfil privado →
  404 inclusive pela URL antiga, G22); rota nova sem sessão entra no
  inventário de G39 com o controle que a substitui.
- Upload com tipo/tamanho/dimensão validados e EXIF removido; `guard` antes de
  qualquer efeito; blob apagado/rotacionado na troca ou remoção.
- CSP permite só a origem das imagens; service worker não guarda (G14).
- ADR do armazenamento; `deploy.md`/`operations.md` com as variáveis.
- Migração aditiva: `photo_key`, `cover_key` (nulas) + `public_photo`,
  `public_cover` (`false`).
