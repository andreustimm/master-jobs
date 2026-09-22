# Necessidades de governança

| ID | Necessidade | Aceitação observável | Tarefas |
|---|---|---|---|
| US-01 | Como implementador, preciso descobrir a regra aplicável antes de editar. | A entrada contém invariantes críticas e um roteador por área; cada obrigação da matriz tem destino, sem exigir invocar skill. | 06, 07, 09 |
| US-02 | Como revisor, preciso distinguir um teste relevante de um nome promissor. | A evidência identifica asserção, entrada adversa, escopo e gatilho; nenhuma aprovação é inferida só da existência do arquivo. | 03–05, 08–11 |
| US-03 | Como responsável por produção, preciso saber que o commit promovido foi validado e que a publicação exige gente. | CI de outro SHA, disparo manual sem CI, push indevido e tentativa automática de publicar são recusados pelas camadas responsáveis. | 01, 02 |
| US-04 | Como candidato, preciso preservar decisões, credenciais e privacidade independentemente do caminho de acesso. | Sync não altera decisões; remoção não destrói histórico; sessão/escopo são verificados; cache não persiste conteúdo privado. | 03–05 |
| US-05 | Como mantenedor do banco, preciso de um procedimento de migração que corresponda ao PostgreSQL atual. | Instruções, journal, schema, DDL e teste de upgrade concordam; credencial de runtime não executa DDL. | 05, 07 |
| US-06 | Como usuário dos três harnesses, preciso receber a mesma política. | Symlinks e ponteiros resolvem para as fontes canônicas; não há cópias por ferramenta nem adaptação normativa divergente. | 06, 07, 09 |
| US-07 | Como mantenedor de uma correção pequena, preciso cumprir os controles sem criar um processo paralelo. | Validação proporcional e reaproveitamento do CI/QA/revisão existentes; nenhuma plataforma nova de recibos ou orquestração. | 08, 09, 11 |

Estas histórias descrevem a implementação futura. Não representam mudanças já entregues ao produto.
