# Fase 3, ajuste pós-iPhone — tela limpa (cadeira `ui`)

O Rica testou na 3008 em 27/09, madrugada, e pediu:

> "Eu não queria ver o texto — a não ser que seja uma coisa provisória pra ver se tá rolando." · "A tela, a UI,
> eu não queria com aquele monte de coisa, botão e não sei o quê. Queria um negócio bem mais limpo." · Sobre
> "Estou de fone": "Coloca essa chave na configuração, junto de onde eu escolho o padrão da UI. Não ali na tela
> me atrapalhando."

## O que muda (só `apps/cockpit/components/conversa/` e tokens em `globals.css`)
1. **Na tela ficam só três coisas:** o visual escolhido ocupando a tela, **um** botão (Começar / Encerrar /
   Retomar, conforme o estado) e, no cabeçalho, Voltar + o ícone de configuração. Nome do agente pode ficar.
2. **A chave "Estou de fone" vai para a folha de configuração**, junto da escolha de visual, e fica guardada no
   aparelho como a escolha de visual. O comportamento dela não muda.
3. **Texto sai da tela:** título grande, detalhe, "Você disse" e a resposta do Zé somem por padrão. A folha ganha
   um interruptor "Mostrar texto" (desligado), para quando ele quiser conferir se está rolando.
4. **Exceções que continuam visíveis sem o interruptor:** erro e aviso que pedem ação dele (microfone negado,
   detector não carregou, tela não mantida acesa), em uma linha curta junto do botão. O estado continua legível
   só pela cor e forma do visual.
5. Acessibilidade: o texto de estado continua existindo para leitor de tela (`aria-live`), só não aparece.
6. Com a Esfera, sem texto embaixo, ela volta a ter o palco inteiro (centralizada).

## Fecha quando
`npm test` e `type-check` verdes, E2E 4/4 em Fio e Matéria (os seletores de texto do roteiro passam a ler o
nó `aria-live` ou `data-*`), uma captura de Fio e uma de Matéria em 393 × 852 com a tela limpa, e as
configurações abertas. Sem commit. Relato curto acrescentado em `relatos/fase3-ui.md`.
