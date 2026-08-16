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
 * do `≡` e do botão de painel: área grande, desenho pequeno.
 *
 * Abre a gaveta de detalhes — o mesmo destino do ⧉ à direita, e isso é atalho,
 * não duplicata: tocar na cara do agente pra ver o agente é o gesto óbvio, e
 * quem chega pelo ⧉ está procurando um painel, não uma pessoa. Vai pelo link
 * OTIMISTA (`LinkAbrePainel`) porque `<Link>` seco custaria os 2,0–2,7s de ida
 * e volta antes de a gaveta se mover — a espera que o Rica pegou ao vivo.
 */
import {
  MIOLO_ACESO,
  MIOLO_DA_PASTILHA,
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
            // O respiro da esquerda é o do retrato, não o do texto: 14px antes
            // da foto empurrariam o nome pra fora da tela no celular.
            paddingLeft: '4px',
            gap: 'var(--ck-space-2)',
            color: 'var(--ck-text-primary)',
          }}
        >
          <Retrato slug={slug} nome={nome} tamanho={RETRATO_NA_PASTILHA} />
          <span className="truncate">{primeiroNome}</span>
        </span>
      </span>
    </LinkAbrePainel>
  );
}
