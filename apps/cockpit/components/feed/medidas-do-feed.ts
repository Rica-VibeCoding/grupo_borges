// As medidas do virtualizador do feed (`feed.tsx`): quantos itens ficam
// montados fora da janela e quanto vale um item que ainda não foi medido.

/** Itens fora da janela mantidos montados — mesmo número do esqueleto, para a
 *  medição continuar comparável. */
export const SOBRA = 6;

/**
 * Altura suposta para item que ainda NÃO foi medido, em px.
 *
 * Constante de propósito, e a doc do @tanstack/react-virtual é explícita sobre
 * o porquê: "If you are dynamically measuring your elements, it's recommended
 * to estimate the largest possible size (within comfort) of your items."
 * Como este feed passa `measureElement` no envelope (mais abaixo), a estimativa
 * é DESCARTADA no primeiro render de cada item — todo trabalho gasto para
 * produzi-la é trabalho jogado fora.
 *
 * E não é pouco trabalho: `getMeasurements` percorre de `pendingMin` até
 * `count` chamando `estimateSize` em cada item não medido (virtual-core 3.17.7,
 * linha 632), e `getMeasurementOptions` zera `pendingMin` sempre que uma opção
 * de medição muda de identidade — `count` inclusive, que muda a cada flush de
 * streaming. Ou seja: ~1.280 chamadas por flush, num feed de 1.300 itens. A
 * versão anterior fazia cinco varreduras de texto por chamada; o cache em
 * WeakMap que veio depois trocou isso por um lookup, mas manteve trabalho por
 * item. A doc manda não fazer o trabalho.
 *
 * O NÚMERO veio de medição, não de palpite: `docs/cockpit-v2-medicao/
 * alturas_reais.py` colheu `offsetHeight` dos 500 itens da carga do canário e
 * os 500 medem 36 px. 44 px é o item colapsado (execução ou raciocínio
 * fechado), que cobre a carga inteira com folga e é o caminho quente da tese do
 * v2 — 82% `tool_use`, que nasce fechado. Errar aqui é barato: a medição real
 * corrige no primeiro render e o virtualizador compensa o delta. Refazer a
 * conta contra tráfego real do Rica (não contra a fixture) é o que muda este
 * número.
 */
export const ALTURA_ITEM = 44;
