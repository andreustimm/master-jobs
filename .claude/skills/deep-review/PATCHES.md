# Desvios locais da skill `deep-review`

A skill é copiada de
[`pedronauck/skills`](https://github.com/pedronauck/skills/tree/main/skills/mine/deep-review),
sem gerenciador de pacote. Este arquivo existe para que uma sincronização futura
com a origem saiba o que foi mudado aqui e por quê — sem ele, o próximo `curl`
por cima apagaria as correções em silêncio.

Ao sincronizar: aplique a origem, releia esta lista e reaplique o que ainda for
necessário. Um desvio que a origem já tenha corrigido deve ser removido daqui.

---

## 1. `scripts/build_manifest.py` — symlink para diretório derruba `--worktree`

**Instalado em:** 21/08/2026
**Estado na origem:** não reportado ainda

`untracked_stat()` fazia `read_bytes()` direto no caminho:

```python
def untracked_stat(repo_root: Path, path: str):
    data = (repo_root / path).read_bytes()
```

`git ls-files --others` lista um symlink para diretório como **uma** entrada, e
`read_bytes()` nela levanta `IsADirectoryError`, derrubando o `--worktree`
inteiro antes de qualquer revisão acontecer.

Não é caso de laboratório neste repositório: a paridade entre os três harnesses é
feita com symlink — `.codex/skills` e `.opencode/skills` apontam para
`.claude/skills` —, e enquanto não estiverem rastreados pelo git eles aparecem
como não rastreados. Foi exatamente assim que o defeito apareceu, na primeira
execução depois de instalar a skill.

**A correção:** tratar o que não é arquivo regular como o binário já era tratado
— sem contagem de linha e não revisável. `is_file()` segue o symlink, então
symlink para ARQUIVO continua sendo revisado normalmente; só o que resolve para
diretório é pulado.

```python
alvo = repo_root / path
if not alvo.is_file():
    return None, None
data = alvo.read_bytes()
```

**Como reproduzir sem o patch:**

```bash
ln -s alguma-pasta ./link-para-pasta     # deixado sem rastrear
python3 .claude/skills/deep-review/scripts/build_manifest.py --out /tmp/x --worktree
# IsADirectoryError
```
