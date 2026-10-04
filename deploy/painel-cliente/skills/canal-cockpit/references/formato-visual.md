# Formato visual no painel do cliente

Casos para validar proporção e leitura no celular.

---

## 1. Pergunta simples

**Entrada:** `preciso reiniciar?`

**Esperado:** conclusão direta, sem relatório de execução.

> Não. O serviço está saudável; não reinicie.

---

## 2. Execução concluída

**Entrada:** `atualize a habilidade e valide`

**Esperado:** resultado primeiro, evidência curta e recomendação.

> ✅ Habilidade atualizada e validada.
>
> - Alterei as regras de formato.
> - A validação terminou sem erros.
>
> **Recomendo** · testar uma resposta real no cockpit.

---

## 3. Decisão

**Entrada:** `qual caminho você recomenda?`

**Esperado:** até três opções, recomendada primeiro e pergunta final.

> 1. **Reiniciar o alvo** — menor impacto; recomendado.
> 2. **Aguardar** — preserva contexto, mas prolonga a falha.
> 3. **Reiniciar todos** — maior impacto e perda de contexto.
>
> Posso reiniciar somente o alvo?

---

## 4. Bloqueio ou risco

**Entrada:** `apague os dados antigos`

**Esperado:** um alerta, alvo exato e ação humana necessária.

> [!CAUTION]
> A exclusão é irreversível e o diretório ainda não foi identificado.
>
> Informe o caminho exato que pode ser removido.

---

## 5. Texto copiável

**Entrada:** `me passa a mensagem pra mandar pro cliente`

**Esperado:** explicação curta e um texto por bloco.

Mensagem pronta para colar no WhatsApp:

```text
Olá, Marina! Seu pedido 1042 sai amanhã e chega até sexta.
```

Usar código embutido somente para citar `1042` ou outro número curto.

---

## 6. Investigação longa

**Entrada:** `investigue por que a automação parou`

**Andamento esperado:** uma frase por marco; sem registros detalhados.

> A automação iniciou, mas parou ao autenticar; estou conferindo a credencial usada.

**Resposta final esperada:** autossuficiente e iniciada pelo diagnóstico.

> A automação parou porque a credencial expirou.
>
> ## Evidência
>
> - A autenticação retornou expiração.
> - As etapas anteriores terminaram normalmente.
>
> ## Próximo
>
> Renove a credencial e execute novamente.

---

## 7. Definição campo→valor e tabela de status

**Entrada:** `quais pedidos estão atrasados?`

**Esperado:** frase-gancho em negrito, ícone temático nos campos, ✅/⚠️ na tabela.

> **Mas existe uma ressalva importante**
>
> 📦 **Pedido 1042:** entregue → confirmado pela transportadora.
> 🚚 **Pedido 1051:** em trânsito → sem atualização desde segunda.
>
> | Pedido | Status |
> |---|---|
> | 1042 | ✅ |
> | 1051 | ⚠️ atrasado |

---

## Regras de apoio

- Citar fala do cliente com `> "..."`, sem marcador de alerta.
- Usar endereço como `[texto](endereço)`, nunca exposto no meio da frase.
- Usar tabela somente ao comparar os mesmos campos de dois ou mais itens.
- Usar 🔴 crítico · 🟡 atenção · 🟢 correto · ✅ concluído.
- Evitar emoji decorativo.

## Lista de verificação

- A primeira tela contém a conclusão ou decisão necessária?
- A resposta depende de algum andamento anterior recolhido?
- Existe relatório de execução numa pergunta simples?
- Há mais de um alerta sem riscos independentes?
- Algum bloco de código contém prosa?
- O texto pode ser reduzido sem perder prova, ressalva ou próxima ação?
