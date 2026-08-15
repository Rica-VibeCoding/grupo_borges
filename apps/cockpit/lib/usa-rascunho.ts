'use client';

/**
 * O RASCUNHO SOBREVIVE — o que ele escreveu e não mandou continua lá depois de
 * recarregar a página.
 *
 * Existe por um caso concreto: no iPhone, puxar a tela para baixo recarrega. O
 * Rica escreve meia mensagem, o dedo esbarra, e o texto morre — sem aviso, sem
 * lugar nenhum onde procurá-lo. É o mesmo defeito de 05/08 (mensagem que evapora
 * calada) por uma porta que ninguém tinha olhado: a do navegador, não a do
 * composer.
 *
 * ## Por que a leitura mora num efeito, e não no `useState` inicial
 *
 * O servidor renderiza esta página e não tem `localStorage`. Semear o estado
 * inicial com ele daria HTML diferente no servidor e no cliente — o mismatch de
 * hidratação que o React trata como erro. Então o campo nasce vazio dos dois
 * lados e o texto salvo entra no primeiro efeito, depois da hidratação.
 *
 * ## Por que a gravação espera o carregamento
 *
 * Sem a trava, a primeira passada do efeito de gravar (com o estado ainda vazio)
 * apagaria o que estava salvo antes de o efeito de leitura rodar. A ordem entre
 * os dois é garantida — efeitos rodam na ordem de declaração —, mas depender
 * disso é frágil: a trava torna a intenção explícita.
 *
 * ## Uma chave por agente
 *
 * O rascunho da conversa com o Felipe não pode aparecer na do Barsi. Trocar de
 * agente recarrega do zero — por isso `slugCarregado` guarda QUAL slug foi
 * carregado, e não um booleano.
 */
import { useEffect, useRef, useState } from 'react';

const PREFIXO = 'ck:rascunho:';

function chave(agentSlug: string): string {
  return `${PREFIXO}${agentSlug}`;
}

/** Teto de segurança: o `localStorage` costuma ter ~5 MB por origem, e um
 *  rascunho gigante ali dentro derrubaria a gravação de todo o resto com
 *  `QuotaExceededError`. O limite de envio já é 65.536 (`porta-de-envio.ts`);
 *  o dobro cobre o texto legítimo com folga e ainda protege a cota. */
const TETO = 131072;

export function usaRascunho(agentSlug: string) {
  const [texto, setTexto] = useState('');
  const slugCarregado = useRef<string | null>(null);

  useEffect(() => {
    let salvo: string | null = null;
    try {
      salvo = window.localStorage.getItem(chave(agentSlug));
    } catch {
      // Modo privativo do Safari e cota estourada lançam aqui. Perder a
      // persistência é aceitável; derrubar o composer não é.
    }
    // Só semeia se houver algo salvo: sobrescrever com `''` apagaria o que o
    // Rica digitou entre a montagem e este efeito.
    if (salvo) setTexto(salvo);
    slugCarregado.current = agentSlug;
  }, [agentSlug]);

  useEffect(() => {
    if (slugCarregado.current !== agentSlug) return;
    try {
      if (texto) window.localStorage.setItem(chave(agentSlug), texto.slice(0, TETO));
      else window.localStorage.removeItem(chave(agentSlug));
    } catch {
      // idem
    }
  }, [texto, agentSlug]);

  return [texto, setTexto] as const;
}
