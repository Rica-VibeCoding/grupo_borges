'use client';

import { useEffect, useState, type ReactElement, type RefObject } from 'react';

import { Command, CommandEmpty, CommandItem, CommandList } from '../ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';

type OrigemDoComando = 'native' | 'project' | 'user' | 'plugin';

type ComandoDeBarra = {
  comando: string;
  descricao: string | null;
  origem: OrigemDoComando;
};

export type BolhaDeComandosProps = {
  agentSlug: string;
  texto: string;
  aoSelecionar: (comando: string) => void;
  campoRef: RefObject<HTMLTextAreaElement | null>;
  children: ReactElement;
  /** Rica pediu Claude Code primeiro, Codex só depois de validado (14/08). */
  ativa?: boolean;
};

const ROTULO_DA_ORIGEM: Record<OrigemDoComando, string> = {
  native: 'nativo',
  project: 'projeto',
  user: 'usuário',
  plugin: 'plugin',
};

function eComandoDeBarra(valor: unknown): valor is ComandoDeBarra {
  if (typeof valor !== 'object' || valor === null) return false;
  const comando = valor as Partial<ComandoDeBarra>;
  return (
    typeof comando.comando === 'string' &&
    (typeof comando.descricao === 'string' || comando.descricao === null) &&
    (comando.origem === 'native' ||
      comando.origem === 'project' ||
      comando.origem === 'user' ||
      comando.origem === 'plugin')
  );
}

/** Sugestões de `/comando` ancoradas no próprio campo, sem busca nesta fase. */
export function BolhaDeComandos({
  agentSlug,
  texto,
  aoSelecionar,
  campoRef,
  children,
  ativa = true,
}: BolhaDeComandosProps) {
  const [aberta, setAberta] = useState(false);
  const [comandos, setComandos] = useState<ComandoDeBarra[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  // O único gatilho desta primeira fase é uma barra num campo vazio. Ao seguir
  // digitando, não há filtro ainda: a bolha fecha para o campo voltar a ser a
  // fonte de verdade até a fase de busca existir. `ativa=false` (Codex, por
  // ora) nunca abre — a lista de nativos é do Claude Code, não faz sentido lá.
  useEffect(() => {
    setAberta(ativa && texto === '/');
  }, [texto, ativa]);

  useEffect(() => {
    if (!aberta) return;
    const abortador = new AbortController();
    setCarregando(true);
    setFalhou(false);
    setComandos([]);

    void fetch(`/api/agents/${encodeURIComponent(agentSlug)}/commands`, {
      cache: 'no-store',
      signal: abortador.signal,
    })
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error(`commands failed: ${resposta.status}`);
        const corpo: unknown = await resposta.json();
        if (!Array.isArray(corpo)) throw new Error('commands response is not a list');
        return corpo.filter(eComandoDeBarra);
      })
      .then((lista) => {
        if (!abortador.signal.aborted) setComandos(lista);
      })
      .catch(() => {
        if (!abortador.signal.aborted) setFalhou(true);
      })
      .finally(() => {
        if (!abortador.signal.aborted) setCarregando(false);
      });

    return () => abortador.abort();
  }, [aberta, agentSlug]);

  function selecionar(comando: string) {
    setAberta(false);
    aoSelecionar(`${comando} `);
    requestAnimationFrame(() => {
      const campo = campoRef.current;
      if (!campo) return;
      campo.focus();
      campo.setSelectionRange(campo.value.length, campo.value.length);
    });
  }

  return (
    <Popover open={aberta} onOpenChange={setAberta}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(evento) => evento.preventDefault()}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
      >
        <Command label="Comandos de barra" shouldFilter={false} loop>
          <CommandList>
            {carregando ? <CommandEmpty>Carregando comandos…</CommandEmpty> : null}
            {falhou ? <CommandEmpty>Não foi possível carregar os comandos.</CommandEmpty> : null}
            {!carregando && !falhou ? (
              <CommandEmpty>Nenhum comando disponível.</CommandEmpty>
            ) : null}
            {comandos.map((comando, indice) => (
              <CommandItem
                key={`${comando.origem}-${comando.comando}-${indice}`}
                value={`${comando.origem}-${comando.comando}-${indice}`}
                onSelect={() => selecionar(comando.comando)}
                aria-label={`Inserir ${comando.comando}`}
              >
                <span className="flex min-w-0 flex-1 flex-col" style={{ gap: '2px' }}>
                  <span className="font-mono text-sm" style={{ color: 'var(--ck-text-primary)' }}>
                    {comando.comando}
                  </span>
                  {comando.descricao ? (
                    <span className="truncate text-xs" style={{ color: 'var(--ck-text-secondary)' }}>
                      {comando.descricao}
                    </span>
                  ) : null}
                </span>
                <span
                  className="shrink-0 text-xs"
                  style={{ color: 'var(--ck-text-tertiary)' }}
                >
                  {ROTULO_DA_ORIGEM[comando.origem]}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
