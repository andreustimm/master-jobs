# Frente B — Alternativas open source e self-hosted

> Dados coletados via API do GitHub em **18/08/2026**. Estrelas, datas de último
> push e licenças foram verificadas na origem, não estimadas.

## Tabela — projetos open source

| Projeto | Estrelas | Último push | Fontes de dados | Faz scoring? | Licença |
|---|---:|---|---|---|---|
| [santifer/career-ops](https://github.com/santifer/career-ops) | **65.306** | 2026-08-18 | Greenhouse, Ashby, Lever, Wellfound (150+ career pages pré-configuradas) + HN "Who is hiring" via Algolia | **Sim** — rubrica A–G avaliada por LLM, nota 1.0–5.0 | MIT |
| [feder-cr/Jobs_Applier_AI_Agent_AIHawk](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk) | **30.203** | 2026-08-18 | LinkedIn (Selenium) | Não — foca em auto-apply e geração de CV | AGPL-3.0 |
| [speedyapply/JobSpy](https://github.com/speedyapply/JobSpy) | **4.107** | 2026-02-18 | LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt, Naukri, BDJobs (scraping) | Não — só coleta, devolve DataFrame | MIT |
| [DaKheera47/job-ops](https://github.com/DaKheera47/job-ops) | **3.855** | 2026-08-18 | Ingestão manual + extensão; self-hosted (Next.js/Docker) | Parcial — análise assistida por LLM | NOASSERTION |
| [GodsScion/Auto_job_applier_linkedIn](https://github.com/GodsScion/Auto_job_applier_linkedIn) | 2.710 | 2026-08-10 | LinkedIn (Selenium) | Não | MIT |
| [PaulMcInnis/JobFunnel](https://github.com/PaulMcInnis/JobFunnel) | 2.179 | 2025-12-10 | Indeed, Monster (scraping estático) | Não — dedup + CSV | MIT |
| [Gsync/jobsync](https://github.com/Gsync/jobsync) | 909 | 2026-08-18 | Entrada manual; tracker self-hosted com Ollama | Parcial — review de CV e match por LLM | MIT |
| [wodsuz/EasyApplyJobsBot](https://github.com/wodsuz/EasyApplyJobsBot) | 808 | 2026-05-18 | LinkedIn, Glassdoor (Easy Apply) | Não | NOASSERTION |
| [DanielPan12/JobHuntBot](https://github.com/DanielPan12/JobHuntBot) | 465 | 2026-08-08 | Agent-driven, multi-board | Parcial | MIT |
| [Donvink/swiss-job-hunter](https://github.com/Donvink/swiss-job-hunter) | 137 | 2026-08-04 | 7 job boards suíços | **Sim** — score contra o CV | AGPL-3.0 |
| [kalil0321/ats-scrapers](https://github.com/kalil0321/ats-scrapers) | 131 | 2026-08-07 | **ATS puros** — mesma tese de coleta que a nossa | Não — é dataset | MIT |
| [theihasan/geezap](https://github.com/theihasan/geezap) | 129 | 2026-03-17 | Agregação multi-API (Laravel) | Parcial | não declarada |
| [vesaias/JobNavigator](https://github.com/vesaias/JobNavigator) | 13 | 2026-08-16 | Multi-source scraping | **Sim** — AI scoring | MIT |

### O caso JobFunnel — a lápide que valida nossa arquitetura

JobFunnel está **arquivado** (`archived: true` na API do GitHub). O autor não
abandonou por desinteresse; ele explicou o motivo no próprio README:

> "JobFunnel foi construído numa era em que os grandes job boards expunham HTML
> majoritariamente estático com paginação simples. (…) Desde então, a maioria dos
> job boards migrou para anti-automação e detecção de bots muito mais agressivas.
> Reimplementar o JobFunnel sobre automação de browser completa (…) é tecnicamente
> possível, mas lento demais, frágil demais e operacionalmente complexo demais
> (…). Em vez de fingir que isso ainda funciona, estou arquivando o projeto."
> — [README do JobFunnel](https://github.com/PaulMcInnis/JobFunnel)

Isso é a evidência mais forte a favor da nossa escolha de **API pública em vez de
scraping**: 2.179 estrelas não impediram o projeto de morrer pelo lado da coleta.
