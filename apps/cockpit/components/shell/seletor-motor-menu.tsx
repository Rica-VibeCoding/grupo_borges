'use client';

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/dropdown-menu';
import { estiloItemDoMenu, ItemDeEscolha } from './item-do-menu';

export type TelaDoSeletor = 'inicio' | 'modelo' | 'esforco' | 'aviso';
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
  rotuloModelo: string | null;
  rotuloDoEsforco: string | null;
  salvando: boolean;
  telaEstreita: boolean;
  aviso: string | null;
  aoMudarTela: (tela: TelaDoSeletor) => void;
  aoFechar: () => void;
};
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
        <ItemDeEscolha
          key={opcao.chave}
          rotulo={opcao.rotulo}
          selecionado={opcao.selecionado}
          desabilitado={salvando}
          aoEscolher={opcao.aoSelecionar}
        />
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
}: Omit<ConteudoDoSeletorProps, 'tela' | 'aviso' | 'aoFechar'>) {
  const estilo = estiloItemDoMenu();
  return (
    <>
      {rotuloModelo !== null && opcoesModelo.length ? (
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
  aviso,
  aoMudarTela,
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
