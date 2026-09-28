'use client';

import { deriveInitials } from '@grupo_borges/cockpit-core/cockpit-types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
 * a imagem DEPOIS de o browser já ter desenhado o ícone de imagem quebrada. O
 * Radix só monta o fallback quando a carga falha, então nunca há quebrado na
 * tela.
 *
 * O estado NÃO mora aqui: o anel da tropa (`.ck-anel`) contorna este retrato
 * por fora, num contêiner — o Root do Radix tem `overflow: hidden`.
 *
 * O fallback é a inicial em neutro, não uma cor por agente: o contrato §4 fecha a
 * paleta e cor por agente seria inventar fora dela.
 */
export function Retrato({
  slug,
  nome,
  tamanho = 40,
  opacidade,
}: {
  slug: string;
  nome: string;
  tamanho?: number;
  opacidade?: number;
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
    </Avatar>
  );
}
