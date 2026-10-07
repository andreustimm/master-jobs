## Técnico

### Corrigido

- `/pipeline` (#492): os `CheckboxPicker` de empresa e canal ganham `key` pelo conjunto marcado na URL, como o seletor de fontes de `/jobs`; voltar, avançar ou "limpar" deixavam a caixa marcada (`defaultChecked` não controlado) e o Aplicar seguinte ressuscitava o filtro. `useAppliedValue` (`app/auto-submit.tsx`) passa a observar a URL (`useSearchParams`) além do valor aplicado: quando o servidor devolve o mesmo valor de antes para um campo que enviou outro (faixa de score invertida igual à aplicada), o campo adota o valor da URL. Vale também para `/jobs`.

## pt-BR

### Corrigido

- No Funil, voltar pelo navegador ou "limpar" empresa e canal agora desmarca as caixas, e o próximo Aplicar não traz de volta o filtro desfeito. A faixa de score digitada ao contrário passa a aparecer nos campos já na ordem certa.

## en

### Fixed

- In the Pipeline, going back in the browser or clearing companies and channels now unticks the boxes, and the next Apply no longer brings the removed filter back. A score range typed the wrong way round now shows in the fields in the right order.
