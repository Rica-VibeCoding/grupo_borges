/**
 * A cápsula do agente — retrato à esquerda, nome à direita, uma peça só.
 *
 * O cabeçalho de identidade dentro do chat saiu em 30/07 por ordem do Rica, e
 * o comentário que ficou no lugar dizia: *"se sentir falta de uma identidade
 * dentro do chat eu aviso"*. Ele avisou em 16/08 — e o que voltou não é aquele
 * cabeçalho. Aquele era uma FAIXA: nome, estado e uma linha divisória cobrando
 * altura de tela pra separar o feed de nada. Esta é um controle na faixa que já
 * existe, sem custo de altura nenhum.
 *
 * SÓ O PRIMEIRO NOME (pedido literal). "Daniel Singh" inteiro não cabe ao lado
 * da pílula de tokens num viewport de 390px, e o sobrenome não desambigua ninguém: a
 * tropa não tem dois Daniel.
 *
 * O ALVO É 44px, A CÁPSULA NÃO. A §3 da estética pede 44×44 de alvo de toque e
 * a §7 pede densidade — os dois cabem porque o link tem a altura da faixa e o
 * desenho, do tamanho do conteúdo. Mesmo arranjo do `≡`: área grande, desenho
 * pequeno.
 *
 * 28/09 (redesenho do chat, aprovado pelo Rica): a cápsula saiu da ponta
 * direita e da pastilha — virou retrato + nome + estado à esquerda, logo depois
 * do `≡`, sem trilho. O estado é a peça viva (`EstadoNoTopo`); a ponta direita
 * ficou pra pílula de tokens.
 *
 * 01/10 (`ideia/sidebar-nova`): virou a PÍLULA DO AGENTE em escala de topo —
 * aro no tom de estado, primeiro nome e a palavra de `estado-da-pilula.ts`, a
 * mesma da gaveta e da tropa. Acabou o "ocioso" aqui e "na linha" lá.
 *
 * Abre a gaveta de detalhes, e desde 27/09 é o ÚNICO gatilho visível dela: o ⧉
 * saiu da barra, porque tocar na cara do agente pra ver o agente é o gesto
 * óbvio. Fecha pelo × da gaveta ou tocando fora. Vai pelo link OTIMISTA
 * (`LinkAbrePainel`) porque `<Link>` seco custaria os 2,0–2,7s de ida e volta
 * antes de a gaveta se mover — a espera que o Rica pegou ao vivo.
 */
'use client';

import { PilulaDoAgente } from './pilula-do-agente';
import { LinkAbrePainel } from './superficie-otimista';
import { usaEstadoDaPilula } from './usa-estado-da-pilula';

export function CapsulaDoAgente({
  slug,
  nome,
  href,
}: {
  slug: string;
  nome: string;
  href: string;
}) {
  const { tom, rotulo } = usaEstadoDaPilula(slug);

  return (
    <LinkAbrePainel
      href={href}
      rotulo={`detalhes de ${nome}`}
      className="flex min-w-0 shrink items-center"
      style={{ minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-pill)' }}
    >
      <PilulaDoAgente slug={slug} nome={nome} tom={tom} rotulo={rotulo} lugar="topo" />
    </LinkAbrePainel>
  );
}
