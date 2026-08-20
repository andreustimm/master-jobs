-- `owner` vira `candidate`.
--
-- O nome antigo descrevia a relação com a instalação ("o dono disto"), não o
-- que a pessoa é no domínio. Com três papéis e várias contas, "dono" deixa de
-- significar alguma coisa.
--
-- `roles` é JSON, então a troca é textual e idempotente: rodar duas vezes não
-- produz `candidatecandidate` porque a segunda passagem não encontra `owner`.
UPDATE auth_user
SET roles = replace(roles, '"owner"', '"candidate"')
WHERE roles LIKE '%"owner"%';
