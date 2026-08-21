# Changelog

Histórico técnico, para quem mexe no código. O resumo em linguagem simples, que
é o exibido no rodapé do sistema, está em [`USER_CHANGELOG.md`](./USER_CHANGELOG.md).

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-08-21

Primeira versão em produção, em `jobs.mastertimm.com.br`. O `package.json`
esteve em `0.1.0` desde o primeiro commit; a marca de cache do service worker
deriva dela, então até aqui nenhum deploy invalidava cache — corrigido junto.

### Adicionado

- **Nome completo na conta** (`AUTH-05`). Coluna `auth_user.full_name`
  anulável, atravessando `Identity` e `Session` até o `session-badge`. Declarar
  o campo como obrigatório no tipo revelou quatro `select` de produção que não
  traziam a coluna — resolvedor de sessão, link mágico, senha e identidade.
- **Edição e exclusão de usuário** em modal de popover nativo, sem JavaScript de
  aplicação. A exclusão recusa a própria conta e o último admin ativo.
- **Pipeline de CI/CD** (`.github/workflows/`): portão de qualidade, verificação
  de sincronia entre `schema.ts` e `drizzle/`, migração por branch e varredura
  diária de vagas.
- **Varredura agendada** (`UI-03`). `varredura.yml` roda `jobs sync`, captura e
  reconferência contra produção. A rota de cron da Vercel processava 25 vagas
  por execução por causa do teto de 30 s do plano gratuito — ciclo de ~17 dias
  contra a meta de 7 de `enqueueStale`.
- **Tela de abertura** inline (`src/core/pwa/splash.ts`), com duração mínima,
  teto absoluto e saída imediata em navegador de automação.
- **Changelog no rodapé**, lido do markdown no servidor.

### Corrigido

- **Área segura da PWA.** `viewportFit: "cover"` estava declarado sem nenhum
  `env(safe-area-inset-*)` para compensar: no app instalado o relógio do sistema
  ficava sobre o nome do aplicativo e a bateria sobre o seletor de idioma.
- **`Number(id)` sem validação em onze comandos** (`B-06`). Os que consultam
  vazavam o `SELECT` inteiro num `DrizzleQueryError`; os que escrevem terminavam
  com código zero sem fazer nada, porque `where id = NaN` não casa com linha
  alguma.
- **`jho tasks done`** (`B-07`) aceitava status fora do vocabulário — a tarefa
  sumia das listagens — e reportava sucesso para id inexistente.
- **`jho dossiers`** (`B-08`) sem destino escrevia em `<cwd>/out/vagas`,
  relativo ao diretório de onde se rodou.
- **Cache do service worker** nunca invalidava: a marca vinha de
  `package.json.version`, fixa em `0.1.0`. Agora é versão + revisão do deploy.
- **Região das funções** movida de `gru1` para `iad1`, junto do banco.

### Infraestrutura

- Turso com três bancos (`master-jobs`, `-staging`, `-dev`) em `aws-us-east-1`,
  variáveis declaradas por branch.
- Três subdomínios na Cloudflare, sem proxy — a nuvem laranja impede a emissão
  do certificado pela Vercel.
- Cobertura de testes de 52 % para **97,7 %** de statements.
