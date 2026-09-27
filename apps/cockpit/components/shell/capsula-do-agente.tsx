/**
 * A cápsula do agente — retrato à esquerda, nome à direita, uma peça só.
 *
 * O cabeçalho de identidade dentro do chat saiu em 30/07 por ordem do Rica, e
 * o comentário que ficou no lugar dizia: *"se sentir falta de uma identidade
 * dentro do chat eu aviso"*. Ele avisou em 16/08 — e o que voltou não é aquele
 * cabeçalho. Aquele era uma FAIXA: nome, estado e uma linha divisória cobrando
 * altura de tela pra separar o feed de nada. Esta é um controle na faixa que já
 * existe, entre o `≡` e o pill de telas, sem custo de altura nenhum.
 *
 * SÓ O PRIMEIRO NOME (pedido literal). "Daniel Singh" inteiro empurra o pill
 * pro lado num viewport de 390px, e o sobrenome não desambigua ninguém: a
 * tropa não tem dois Daniel.
 *
 * IRMÃ DA PASTILHA DE TELAS. O desenho — trilho, miolo, altura, cor — sai todo
 * de `pastilha-do-chrome.ts`, e é de lá que se muda: *"sempre que uma mudar a
 * outra vai mudar também"* (Rica, 16/08). Daqui só sai o que é próprio desta:
 * o retrato e o respiro menor à esquerda pra ele caber.
 *
 * O ALVO É 44px, A CÁPSULA NÃO. A §3 da estética pede 44×44 de alvo de toque e
 * a §7 pede densidade — os dois cabem porque o link tem a altura da faixa e o
 * fundo pintado é o `<span>` de dentro, do tamanho do conteúdo. Mesmo arranjo
 * do `≡`: área grande, desenho pequeno.
 *
 * O NOME SÓ ENTRA COM LUGAR PRA ELE. No celular de 390px a coluna da cápsula
 * tem ~144px, e o nome truncava até sumir — mas o vão e o respiro de 14px
 * ficavam, e a foto parecia desenquadrada, encostada à esquerda de uma pílula
 * meio vazia (Rica, 27/09). Agora a cápsula mede a coluna (`@container` na
 * barra): a partir de 10rem entra o nome; abaixo disso é só a foto, com o mesmo
 * respiro dos dois lados — centrada. O nome continua no rótulo do link.
 *
 * Abre a gaveta de detalhes, e desde 27/09 é o ÚNICO gatilho visível dela: o ⧉
 * saiu da barra, porque tocar na cara do agente pra ver o agente é o gesto
 * óbvio. Fecha pelo × da gaveta ou tocando fora. Vai pelo link OTIMISTA
 * (`LinkAbrePainel`) porque `<Link>` seco custaria os 2,0–2,7s de ida e volta
 * antes de a gaveta se mover — a espera que o Rica pegou ao vivo.
 */
import {
  MIOLO_ACESO,
  MIOLO_DA_PASTILHA,
  RESPIRO_DO_MIOLO,
  RESPIRO_DO_RETRATO,
  RETRATO_NA_PASTILHA,
  TRILHO_DA_PASTILHA,
} from './pastilha-do-chrome';
import { Retrato } from './retrato';
import { LinkAbrePainel } from './superficie-otimista';

export function CapsulaDoAgente({
  slug,
  nome,
  href,
}: {
  slug: string;
  nome: string;
  href: string;
}) {
  const primeiroNome = nome.split(' ')[0] || nome;

  return (
    <LinkAbrePainel
      href={href}
      rotulo={`detalhes de ${nome}`}
      className="flex min-w-0 shrink items-center"
      style={{ minHeight: 'var(--ck-touch-min)' }}
    >
      <span className="flex min-w-0 items-center" style={TRILHO_DA_PASTILHA}>
        <span
          className="flex min-w-0 items-center"
          style={{
            ...MIOLO_DA_PASTILHA,
            background: MIOLO_ACESO,
            // O respiro em volta é o do retrato; o do texto vem com o nome, e
            // some junto com ele quando não há lugar.
            padding: `0 ${RESPIRO_DO_RETRATO}px`,
            gap: 'var(--ck-space-2)',
            color: 'var(--ck-text-primary)',
          }}
        >
          <Retrato slug={slug} nome={nome} tamanho={RETRATO_NA_PASTILHA} />
          <span
            className="hidden min-w-0 truncate @min-[10rem]:block"
            style={{ paddingRight: RESPIRO_DO_MIOLO - RESPIRO_DO_RETRATO }}
          >
            {primeiroNome}
          </span>
        </span>
      </span>
    </LinkAbrePainel>
  );
}
