/**
 * O enfeite da frase de apoio (30/09, pedido do Rica): a descrição do passo ("Tô lendo o
 * código") ganha, às vezes, um vocativo ou marcador de conversa na frente ("Rica…", "Olha,")
 * e, mais raro, um fecho depois ("Já te falo."). Nunca a mesma abertura duas vezes seguidas,
 * e às vezes a frase vai pura — para a espera não soar sempre igual.
 */
export const ABERTURAS = ['', 'Rica… ', 'Olha, ', 'Então, ', 'Peraí, ', 'Só um instante… ', 'Beleza, ', 'Rica, '] as const;
export const FECHOS = [' Já volto.', ' Já te falo.', ' Segura aí um pouquinho.', ' Já volto com a resposta.'] as const;
/** Chance de a frase ganhar um fecho depois (o antes é o que mais funciona). */
export const CHANCE_DO_FECHO = 0.2;

const minusculaNoInicio = (texto: string) => texto.charAt(0).toLocaleLowerCase('pt-BR') + texto.slice(1);
const fechaFrase = (texto: string) => (/[.!?…]$/u.test(texto) ? texto : `${texto}.`);

export function criaEnfeiteDoApoio(sorteio: () => number = Math.random) {
  let ultima = -1;
  return (descricao: string): string => {
    const texto = descricao.trim();
    if (texto === '') return descricao;
    // Sorteia entre as que não são a última: a de índice igual ou maior pula uma casa.
    const opcoes = ultima < 0 ? ABERTURAS.length : ABERTURAS.length - 1;
    let i = Math.min(Math.floor(sorteio() * opcoes), opcoes - 1);
    if (ultima >= 0 && i >= ultima) i += 1;
    ultima = i;
    const abertura = ABERTURAS[i];
    const miolo = abertura === '' ? texto : `${abertura}${minusculaNoInicio(texto)}`;
    if (sorteio() >= CHANCE_DO_FECHO) return miolo;
    return fechaFrase(miolo) + FECHOS[Math.min(Math.floor(sorteio() * FECHOS.length), FECHOS.length - 1)];
  };
}
