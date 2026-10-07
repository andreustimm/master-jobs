## Técnico

### Adicionado

- Cadastro aberto em tela única (#464, ADR-007): `/signup` com papel (Candidato ou Recrutador, nunca admin), nome, headline e currículo (PDF ou texto, com as regras do onboarding), aceite dos Termos e da Política, e painel da marca. No modo social a tela mostra o e-mail que o provedor confirmou; no manual, e-mail e senha.
- Cadastro manual confirmado por código (ADR-006): `/signup/verify` com código de 6 dígitos (HMAC com `JHO_SIGNUP_IP_SECRET`, 15 minutos, trava em 5 erros), reenvio a cada 60 s, cinco envios por e-mail por hora e pendência descartada em 24 h. E-mail já cadastrado vê a mesma tela e recebe o aviso de conta existente, sem código.
- Regras puras em `domain/signup-rules.ts` e serviço `app/signup.ts` (`SignupResult`); a loja (`infra/drizzle-signups.ts`) cria conta, identidade do provedor e candidato com o CV como primeira versão (`insertOwnCandidate`) numa transação só, com travas consultivas por e-mail e por IP.
- Limite de 3 cadastros concluídos por `ip_hmac` por hora (`JHO_SIGNUP_MAX_PER_IP_HOUR`), reservado sob concorrência; pendência e conta criada por admin não contam; nenhum IP cru gravado. Evento `signup_ip_capped`.
- Boas-vindas só para conta criada pelo cadastro, no idioma da tela; falha de envio grava `email_send_failed` e não desfaz a conta. Eventos `signup_started`, `signup_code_sent`, `signup_code_failed`, `signup_completed` (caminho, papel e versões aceitas).
- Páginas públicas `/terms` e `/privacy` renderizam `content/legal/` (Markdown sem HTML cru); `/login` ganha "Criar conta"; `/recruiter` explica ao recrutador sem candidatos de onde vem o acesso.
- `mailDelivery`/`manualSignupAvailable`: onde o e-mail não sai (Preview), o cadastro manual fica indisponível com aviso.
- E2E: áreas `sign-up` (E2E-011 a E2E-015, E2E-024 a E2E-029) e `legal` (E2E-031); axe das telas sem sessão antes do login.

### Alterado

- `signup`, `terms` e `privacy` entram nos endereços públicos reservados (`RESERVED_SLUGS`).

## pt-BR

### Novidades

- Agora dá para criar a própria conta em "Criar conta", como candidato ou como recrutador, pelo Google, pelo LinkedIn ou com e-mail e senha confirmados por um código enviado ao e-mail.
- O candidato sai do cadastro com o perfil e o currículo já guardados, e as vagas passam a ser pontuadas contra ele. O recrutador vê uma explicação de como o acesso aos candidatos chega.
- Os Termos de Uso e a Política de Privacidade podem ser lidos sem conta, em português e em inglês.

## en

### What's new

- You can now create your own account from "Create account", as a candidate or as a recruiter, with Google, LinkedIn, or email and password confirmed by a code sent to your email.
- Candidates finish sign-up with their profile and CV already saved, and jobs start being scored against it. Recruiters see an explanation of how access to candidates arrives.
- The Terms of Use and Privacy Policy can be read without an account, in Portuguese and English.
