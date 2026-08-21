'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * `InputGroupButton` do shadcn/ui (MIT), vendorizado como o resto de
 * `components/ui/` — mesma adaptação que o `dropdown-menu.tsx` daqui já faz:
 * a estrutura e as medidas vêm da biblioteca, as cores saem dos `--ck-*`
 * porque este app não carrega a camada de tokens do shadcn.
 *
 * VEIO SÓ O BOTÃO. O arquivo original traz também `InputGroup`,
 * `InputGroupAddon`, `InputGroupInput` e `InputGroupTextarea`, que montam a
 * caixa e o campo — e a caixa do composer já existe, medida e com bancada.
 *
 * Por que este e não outro: os três lugares gratuitos que resolvem esta caixa
 * hoje convergem no mesmo número (conferido no fonte dos registries, 21/08).
 *
 *   shadcn/ui           `InputGroupButton size="icon-sm"`  → `size-8`, svg `size-4`
 *   Vercel AI Elements  `PromptInputSubmit`                → o mesmo `icon-sm`
 *   assistant-ui        `ComposerSend` / `VoiceButton`     → `grid size-8`
 *
 * 32px de disco, 16px de ícone. A escala completa do original tem ainda `xs`,
 * `sm` e `icon-xs` (24px); entra aqui o que a caixa usa.
 */
const variantesDoBotaoDaCaixa = cva(
  // A base é a do `Button` do shadcn, sem as classes que dependem de token que
  // não existe aqui. A regra do `svg` é a que importa e é dele: ícone sem
  // tamanho declarado em classe nasce com 16px — nossos ícones trazem
  // `width`/`height` como atributo, e CSS ganha de atributo de apresentação.
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm shadow-none outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** Massa: o botão que conclui a ação. */
        default: 'bg-[var(--ck-text-primary)] text-[var(--ck-surface-canvas)]',
        /** Contorno: existe, mas não disputa o olho com o vizinho de massa. */
        ghost: 'bg-transparent text-[var(--ck-text-secondary)]',
      },
      size: {
        'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'icon-sm',
    },
  },
);

export function InputGroupButton({
  className,
  type = 'button',
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof variantesDoBotaoDaCaixa>) {
  return (
    <button
      type={type}
      data-slot="input-group-button"
      data-size={size ?? 'icon-sm'}
      className={cn(variantesDoBotaoDaCaixa({ variant, size }), className)}
      {...props}
    />
  );
}
