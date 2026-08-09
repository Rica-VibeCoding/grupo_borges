'use client';

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/dropdown-menu';

export type TelaDoSeletor = 'inicio' | 'modelo' | 'esforco' | 'confirmacao' | 'aviso';
export type OpcaoDoMotor = {
  chave: string;
  rotulo: string;
  selecionado: boolean;
  aoSelecionar: () => void;
};
type ConteudoDoSeletorProps = {
  tela: TelaDoSeletor;
  opcoesModelo: OpcaoDoMotor[];
  opcoesEsforco: OpcaoDoMotor[];
  rotuloModelo: string;
  rotuloDoEsforco: string | null;
  salvando: boolean;
  telaEstreita: boolean;
  modeloPendente: string | null;
  aviso: string | null;
  aoMudarTela: (tela: TelaDoSeletor) => void;
  aoConfirmarTroca: () => void;
  aoFechar: () => void;
};
function estiloItemDoMenu(selecionado = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 'var(--ck-touch-min)',
    // Sem gap, rótulo e valor encostam quando o texto enche a largura do menu:
    // `space-between` só separa o que sobra, e "Esforço" + "extra alto" não
    // sobrava nada — o Rica leu "Esforçoextra alto" na tela em 09/08.
    gap: 'var(--ck-space-3)',
    padding: 'var(--ck-space-2) var(--ck-space-3)',
    borderRadius: 'var(--ck-radius-chip)',
    color: 'var(--ck-text-primary)',
    fontSize: 'var(--ck-text-base)',
    textAlign: 'left' as const,
    ...(selecionado
      ? { backgroundImage: 'linear-gradient(var(--ck-overlay-selected), var(--ck-overlay-selected))' }
      : {}),
  };
}
function LinhaDeSubmenu({ rotulo, atual }: { rotulo: string; atual: string }) {
  return (
    <>
      <span>{rotulo}</span>
      <span className="flex items-center" style={{ gap: 'var(--ck-space-2)', color: 'var(--ck-text-secondary)' }}>
        {atual}
        <span aria-hidden>›</span>
      </span>
    </>
  );
}

function ListaDeOpcoes({ opcoes, salvando }: { opcoes: OpcaoDoMotor[]; salvando: boolean }) {
  return (
    <>
      {opcoes.map((opcao) => (
        <DropdownMenuItem
          key={opcao.chave}
          disabled={salvando}
          onSelect={(evento) => {
            evento.preventDefault();
            opcao.aoSelecionar();
          }}
          style={estiloItemDoMenu(opcao.selecionado)}
        >
          <span>{opcao.rotulo}</span>
          <span aria-hidden style={{ color: 'var(--ck-text-secondary)' }}>
            {opcao.selecionado ? '✓' : ''}
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

function TelaDeOpcoes({
  titulo,
  opcoes,
  salvando,
  aoVoltar,
}: {
  titulo: string;
  opcoes: OpcaoDoMotor[];
  salvando: boolean;
  aoVoltar: () => void;
}) {
  return (
    <>
      <DropdownMenuItem
        disabled={salvando}
        onSelect={(evento) => {
          evento.preventDefault();
          aoVoltar();
        }}
        style={estiloItemDoMenu()}
      >
        <span className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <span aria-hidden>‹</span>
          {titulo}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ListaDeOpcoes opcoes={opcoes} salvando={salvando} />
    </>
  );
}

function MenuInicial({
  opcoesModelo,
  opcoesEsforco,
  rotuloModelo,
  rotuloDoEsforco,
  salvando,
  telaEstreita,
  aoMudarTela,
}: Omit<ConteudoDoSeletorProps, 'tela' | 'modeloPendente' | 'aviso' | 'aoConfirmarTroca' | 'aoFechar'>) {
  const estilo = estiloItemDoMenu();

  return (
    <>
      {opcoesModelo.length ? (
        telaEstreita ? (
          <DropdownMenuItem
            disabled={salvando}
            onSelect={(evento) => {
              evento.preventDefault();
              aoMudarTela('modelo');
            }}
            style={estilo}
          >
            <LinhaDeSubmenu rotulo="Modelo" atual={rotuloModelo} />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={salvando} style={estilo}>
              <LinhaDeSubmenu rotulo="Modelo" atual={rotuloModelo} />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                className="ck-menu-surge ck-menu-aberto"
                sideOffset={4}
                collisionPadding={8}
                style={{ width: 'var(--ck-w-menu-sub)' }}
              >
                <ListaDeOpcoes opcoes={opcoesModelo} salvando={salvando} />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        )
      ) : null}

      {opcoesEsforco.length ? (
        telaEstreita ? (
          <DropdownMenuItem
            disabled={salvando}
            onSelect={(evento) => {
              evento.preventDefault();
              aoMudarTela('esforco');
            }}
            style={estilo}
          >
            <LinhaDeSubmenu rotulo="Esforço" atual={rotuloDoEsforco ?? 'sem ajuste'} />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={salvando} style={estilo}>
              <LinhaDeSubmenu rotulo="Esforço" atual={rotuloDoEsforco ?? 'sem ajuste'} />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                className="ck-menu-surge ck-menu-aberto"
                sideOffset={4}
                collisionPadding={8}
                style={{ width: 'var(--ck-w-menu-sub)' }}
              >
                <ListaDeOpcoes opcoes={opcoesEsforco} salvando={salvando} />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        )
      ) : null}
    </>
  );
}

export function ConteudoDoSeletor({
  tela,
  opcoesModelo,
  opcoesEsforco,
  rotuloModelo,
  rotuloDoEsforco,
  salvando,
  telaEstreita,
  modeloPendente,
  aviso,
  aoMudarTela,
  aoConfirmarTroca,
  aoFechar,
}: ConteudoDoSeletorProps) {
  if (tela === 'inicio') {
    return (
      <MenuInicial
        opcoesModelo={opcoesModelo}
        opcoesEsforco={opcoesEsforco}
        rotuloModelo={rotuloModelo}
        rotuloDoEsforco={rotuloDoEsforco}
        salvando={salvando}
        telaEstreita={telaEstreita}
        aoMudarTela={aoMudarTela}
      />
    );
  }

  if (tela === 'modelo' || tela === 'esforco') {
    return (
      <TelaDeOpcoes
        titulo={tela === 'modelo' ? 'Modelo' : 'Esforço'}
        opcoes={tela === 'modelo' ? opcoesModelo : opcoesEsforco}
        salvando={salvando}
        aoVoltar={() => aoMudarTela('inicio')}
      />
    );
  }

  if (tela === 'confirmacao') {
    return (
      <>
        <p
          style={{
            padding: 'var(--ck-space-2) var(--ck-space-3)',
            color: 'var(--ck-text-secondary)',
            fontSize: 'var(--ck-text-base)',
          }}
        >
          O agente está trabalhando. Trocar o modelo agora pode interromper a tarefa atual.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={salvando}
          onSelect={(evento) => {
            evento.preventDefault();
            aoMudarTela('inicio');
          }}
          style={estiloItemDoMenu()}
        >
          Cancelar
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={salvando || modeloPendente === null}
          onSelect={(evento) => {
            evento.preventDefault();
            aoConfirmarTroca();
          }}
          style={estiloItemDoMenu(true)}
        >
          Trocar mesmo assim
        </DropdownMenuItem>
      </>
    );
  }

  if (aviso) {
    return (
      <>
        <p
          aria-live="polite"
          style={{
            padding: 'var(--ck-space-2) var(--ck-space-3)',
            color: 'var(--ck-state-attention)',
            fontSize: 'var(--ck-text-base)',
          }}
        >
          {aviso}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(evento) => {
            evento.preventDefault();
            aoFechar();
          }}
          style={estiloItemDoMenu()}
        >
          Entendi
        </DropdownMenuItem>
      </>
    );
  }

  return null;
}
