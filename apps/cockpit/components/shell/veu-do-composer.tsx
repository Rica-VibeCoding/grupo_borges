/**
 * O VÉU — a faixa translúcida por trás do composer flutuante.
 *
 * É a exceção de blur da §9.2 do contrato de estética, que estava escrita desde
 * 30/07 ("permitido só no composer flutuante, um elemento") e nunca tinha sido
 * exercida: até 08/08 o repo não tinha um `backdrop-filter` sequer. Este é o
 * elemento. Não há um segundo, e a §9.13 continua proibindo blur no véu de
 * modal.
 *
 * O QUE É TRANSLÚCIDO, E O QUE NÃO É. O Rica mandou duas referências e elas
 * pedem coisas diferentes. No ChatGPT (a que vale) o campo é SÓLIDO e só a
 * faixa em volta deixa passar o texto borrado. No Telegram (a que não vale) os
 * próprios controles são de vidro, com a foto de perfil aparecendo por trás do
 * campo. A escolha não é de gosto: texto sobre superfície translúcida tem
 * contraste que depende do que está passando por baixo, e o piso de 7:1 da §3
 * não admite "depende". Por isso o campo continua `--ck-surface-composer`
 * sólido e a régua de contraste inteira segue valendo sem remedição — nenhum
 * texto passou a pisar em superfície nova.
 *
 * ONDE ELE MORA. Camada de fundo dentro do wrapper do composer, em
 * `app/agente/[slug]/palco-da-conversa.tsx`. O wrapper precisa dar
 * `position: relative` ao irmão que carrega o composer — é isso, e só isso, que
 * põe a caixa por cima do véu. Este componente não usa `z-index` negativo de
 * propósito: `-1` só se comporta dentro de um stacking context, e depender de
 * um que mora em arquivo de outra pessoa é como o desfoque some sem ninguém
 * ver.
 *
 * TUDO DE PELE (cor, desfoque, fade) mora em `.ck-veu-composer`, no
 * `globals.css`, junto das armadilhas de Backdrop Root que decidem se este
 * elemento funciona ou vira uma faixa cinza sem erro nenhum no console.
 */
export function VeuDoComposer() {
  return <div aria-hidden className="ck-veu-composer" />;
}
