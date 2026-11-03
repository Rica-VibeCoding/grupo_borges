'use client';

import type { ReactElement } from 'react';

import { Command, CommandItem, CommandList } from '../ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { COMANDOS_DO_COCKPIT, type ComandoDoCockpit } from './comandos-do-cockpit';

export type BolhaDeComandosProps = {
  /** Quem decide é o composer (`bolhaAberta`): o véu dele depende disso. */
  aberta: boolean;
  aoDispensar: () => void;
  /** Comando do cockpit: resolvido no front, nunca vai pro agente como texto. */
  aoEscolher: (comando: ComandoDoCockpit) => void;
  /** Comandos próprios do agente: escolher só escreve no campo. */
  doAgente: string[];
  aoEscolherDoAgente: (comando: string) => void;
  children: ReactElement;
};

/** Os comandos de barra do cockpit, ancorados no próprio campo. */
export function BolhaDeComandos({
  aberta, aoDispensar, aoEscolher, doAgente, aoEscolherDoAgente, children,
}: BolhaDeComandosProps) {
  return (
    <Popover open={aberta} onOpenChange={(abrir) => !abrir && aoDispensar()}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        // A âncora é o campo, não a caixa do composer — o `sideOffset` padrão
        // (8px) mede a partir do topo do TEXTAREA, que já nasce recuado pelo
        // padding da caixa (`--ck-space-3`, 12px) mais a borda (1px). Sem
        // compensar isso a bolha sobra 5px DENTRO da caixa em vez de flutuar
        // acima dela — foi o que o Rica viu como "truncando" (15/08). 21 = 1
        // (borda) + 12 (`--ck-space-3`) + 8 (`--ck-space-2`, o mesmo respiro
        // que a gaveta do "+" usa em `.ck-gaveta-acima`).
        sideOffset={21}
        onOpenAutoFocus={(evento) => evento.preventDefault()}
        // O mesmo surgir dos outros menus do composer (motor, ações): sem ele
        // a bolha abria e fechava seca. O Radix espera a animação de saída.
        className={`ck-menu-surge ${aberta ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
        style={{
          width: 'var(--radix-popover-trigger-width)',
          transformOrigin: 'var(--radix-popover-content-transform-origin)',
        }}
      >
        <Command label="Comandos de barra" shouldFilter={false} loop>
          <CommandList>
            {COMANDOS_DO_COCKPIT.map((comando) => (
              <CommandItem key={comando} value={comando} onSelect={() => aoEscolher(comando)}>
                <span className="min-w-0 flex-1 font-mono text-sm" style={{ color: 'var(--ck-text-primary)' }}>
                  {comando}
                </span>
              </CommandItem>
            ))}
            {doAgente.map((comando) => (
              <CommandItem key={comando} value={comando} onSelect={() => aoEscolherDoAgente(comando)}>
                <span className="min-w-0 flex-1 font-mono text-sm" style={{ color: 'var(--ck-text-primary)' }}>
                  {comando}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
