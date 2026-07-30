'use client';

import { deriveInitials } from '@grupo_borges/cockpit-core/cockpit-types';
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * Retrato — a cara do agente.
 *
 * Por que retrato e não emoji: a primeira TROPA usava `agent.emoji`, e três
 * agentes vêm com o campo nulo, então viravam uma bolinha `•` no meio de
 * foguete, alvo e estrela. O cockpit antigo nunca usou emoji — usa
 * `/avatars/<slug>` desde sempre, e é daí que vem o "mais bonito". Trouxe os dez
 * retratos (19 MB de PNG 1024² viraram 25 KB de WebP 128², porque quem abre isso
 * abre no 4G).
 *
 * Por que o Avatar do Radix e não `<img onError>`: o `onError` do antigo esconde
 * a imagem DEPOIS de o browser já ter desenhado o ícone de imagem quebrada — dá
 * pra ver isso no Canário, que não tem retrato. O Radix só monta o fallback
 * quando a carga falha, então nunca há quebrado na tela.
 *
 * O fallback é a inicial em neutro, não uma cor por agente: o contrato §4 fecha a
 * paleta e cor por agente seria inventar fora dela.
 */
export function Retrato({
  slug,
  nome,
  tamanho = 40,
  opacidade,
  marca,
}: {
  slug: string;
  nome: string;
  tamanho?: number;
  opacidade?: number;
  /** Ponto de estado no canto do retrato — usado onde não cabe a palavra
   *  (coluna de 260px do desktop). `rotulo` é o que a leitura de tela anuncia:
   *  cor sozinha nunca carrega o sentido. */
  marca?: { cor: string; rotulo: string; estado: string };
}) {
  return (
    <Avatar
      className="shrink-0 self-center"
      style={{
        // `flex` + `width`/`height` não bastam: o Root é item de flex e ganha
        // `align-self: stretch` do pai, esticando a foto na vertical. `flexBasis`
        // fixo + `self-center` prendem a caixa no quadrado.
        flex: `0 0 ${tamanho}px`,
        width: tamanho,
        height: tamanho,
        opacity: opacidade,
        borderRadius: 'var(--ck-radius-chip)',
        background: 'var(--ck-surface-raised)',
      }}
    >
      <AvatarImage
        src={`/avatars/${slug}.webp`}
        alt=""
        style={{ borderRadius: 'var(--ck-radius-chip)' }}
      />
      <AvatarFallback
        style={{
          borderRadius: 'var(--ck-radius-chip)',
          background: 'var(--ck-surface-raised)',
          fontFamily: 'var(--ck-font-mono)',
          fontSize: tamanho >= 40 ? 'var(--ck-text-sm)' : 'var(--ck-text-xs)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        {deriveInitials(nome)}
      </AvatarFallback>

      {marca ? (
        <AvatarBadge
          className="ck-pulso"
          data-estado={marca.estado}
          role="img"
          aria-label={marca.rotulo}
          title={marca.rotulo}
          style={{
            width: '9px',
            height: '9px',
            background: marca.cor,
            // O anel é da cor da superfície onde o retrato pousa: sem ele o ponto
            // encosta na foto e some contra um rosto claro.
            boxShadow: '0 0 0 2px var(--ck-surface-nav)',
          }}
        />
      ) : null}
    </Avatar>
  );
}
