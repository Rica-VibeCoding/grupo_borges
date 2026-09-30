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
  /** Desligada quando o motor do agente não tem slash command. */
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

/**
 * A última lista lida de cada agente, viva enquanto a página vive. A bolha abre
 * com ela NA HORA e relê por baixo — antes, toda `/` esvaziava a lista e
 * piscava "Carregando comandos…" até a rede voltar. Lista de comando velha não
 * engana ninguém como cota velha engana: o pior caso é um comando novo do
 * projeto aparecer uma releitura depois.
 */
const comandosLidos = new Map<string, ComandoDeBarra[]>();

function mesmaLista(a: ComandoDeBarra[] | undefined, b: ComandoDeBarra[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      item.comando === b[i].comando &&
      item.descricao === b[i].descricao &&
      item.origem === b[i].origem,
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
  // O único gatilho desta primeira fase é uma barra num campo vazio. Ao seguir
  // digitando, não há filtro ainda: a bolha fecha para o campo voltar a ser a
  // fonte de verdade até a fase de busca existir. `ativa=false` (por
  // ora) nunca abre — a lista de nativos é do Claude Code, não faz sentido lá.
  //
  // Derivada no render, não copiada por efeito: o efeito custava um segundo
  // render a cada tecla. O único estado é "fechada à mão" (Esc, toque fora,
  // escolha), que zera assim que o campo deixa de ser só `/`.
  const deveAbrir = ativa && texto === '/';
  const [dispensada, setDispensada] = useState(false);
  if (dispensada && !deveAbrir) setDispensada(false);
  const aberta = deveAbrir && !dispensada;

  const [, setLeituras] = useState(0);
  // A falha é DO AGENTE que falhou: guardada com o slug, o `falhou` do A não
  // aparece nem por um quadro no B (o componente não remonta na troca).
  const [falhouEm, setFalhouEm] = useState<string | null>(null);
  const falhou = falhouEm === agentSlug;
  const guardados = comandosLidos.get(agentSlug);
  // "Carregando" só existe na primeira leitura deste agente — e sai do render,
  // não de um estado ligado por efeito, então nem um quadro de "Nenhum
  // comando" escapa antes dele.
  const carregando = guardados === undefined && !falhou;
  const comandos = guardados ?? [];

  useEffect(() => {
    if (!aberta) return;
    const abortador = new AbortController();
    const temLista = comandosLidos.has(agentSlug);
    setFalhouEm(null);

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
        if (abortador.signal.aborted) return;
        // Releitura igual à guardada não redesenha a bolha.
        if (mesmaLista(comandosLidos.get(agentSlug), lista)) return;
        comandosLidos.set(agentSlug, lista);
        setLeituras((n) => n + 1);
      })
      .catch(() => {
        // Com lista guardada na tela, a releitura que falha fica calada: a
        // lista anterior continua servindo.
        if (!abortador.signal.aborted && !temLista) setFalhouEm(agentSlug);
      });

    return () => abortador.abort();
  }, [aberta, agentSlug]);

  function selecionar(comando: string) {
    setDispensada(true);
    aoSelecionar(`${comando} `);
    requestAnimationFrame(() => {
      const campo = campoRef.current;
      if (!campo) return;
      campo.focus();
      campo.setSelectionRange(campo.value.length, campo.value.length);
    });
  }

  return (
    <Popover open={aberta} onOpenChange={(abrir) => setDispensada(!abrir)}>
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
