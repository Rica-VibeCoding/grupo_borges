/**
 * A TROCA DE AGENTE PELA TROPA (28/09). No toque, o palco da conversa que sai
 * apaga para 0,6 — o Rica vê que o toque pegou antes de a conversa nova
 * chegar. Quem diz se há troca em voo é o `slugOtimo` do `tropa-ao-vivo.tsx`:
 * ele vira no toque e volta sozinho ao slug da URL quando a transição termina,
 * chegando ou morrendo. Derivar o esmaecimento DELE, e não de um "comecei" e
 * "terminei" escritos à mão, é o que impede o palco de ficar preso apagado:
 * navegação que falha reverte o otimista, e o esmaecimento some junto.
 *
 * Tocar no agente que já está aberto não é troca — o palco fica aceso.
 *
 * Aqui mora só a conta, onde o `node --test` alcança; o fio (atributo no
 * `<html>`, efeito) fica em `tropa-ao-vivo.tsx`, e o movimento em `globals.css`
 * (`.ck-palco`).
 */
export function trocandoDeAgente(slugOtimo: string | undefined, slugDaUrl: string | undefined): boolean {
  return slugOtimo !== undefined && slugOtimo !== slugDaUrl;
}
