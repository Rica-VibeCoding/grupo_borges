import type { Viewport } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/shell/app-shell';
import { TelaDoAgente } from '@/components/tela-agente/tela-do-agente';
import { fetchMaquinas } from '@/lib/maquinas';
import { fetchChromes } from '@/lib/tela-agente';

// Tela do agente — o Chrome de um agente ao vivo, com Assumir e Devolver.
// Duas portas: o botão "Ver tela" na linha do Chrome em Abertos, e o link do aviso
// urgente quando o agente trava (`?pedido=<id>`), que abre já com o motivo.
// Contrato: docs/tela-do-agente/contrato-api.md.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#222222' };

export default async function TelaDoChrome({
  params,
  searchParams,
}: {
  params: Promise<{ maquina: string; chrome: string }>;
  searchParams: Promise<{ pedido?: string }>;
}) {
  const [{ maquina, chrome }, { pedido }] = await Promise.all([params, searchParams]);
  const [catalogo, maquinas] = await Promise.all([fetchChromes().catch(() => null), fetchMaquinas().catch(() => [])]);
  const doCatalogo = catalogo?.find((c) => c.id === chrome);
  // Catálogo lido e o Chrome não está nele (ou é de outra máquina): endereço errado.
  if (catalogo && (!doCatalogo || doCatalogo.maquina !== maquina)) notFound();
  const nomeDaMaquina = maquinas.find((m) => m.id === maquina)?.nome ?? maquina;

  return (
    <AppShell palco="mesa">
      <TelaDoAgente
        chrome={chrome}
        rotulo={doCatalogo?.rotulo ?? `Chrome ${chrome}`}
        maquina={maquina}
        nomeDaMaquina={nomeDaMaquina}
        pedido={pedido ?? null}
      />
    </AppShell>
  );
}
