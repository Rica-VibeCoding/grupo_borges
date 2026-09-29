import { redirect } from 'next/navigation';

/**
 * A conversa por voz mora no pager da página do agente, ao lado do chat (fase 3): a mesma
 * página, montada uma vez. Esta rota é só a entrada direta — leva ao pager com a voz primeiro,
 * e o pager devolve a URL para `/conversa/{slug}` sem navegar.
 */
export default async function ConversaPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(await searchParams)) {
    if (Array.isArray(valor)) valor.forEach((item) => busca.append(chave, item));
    else if (valor !== undefined) busca.set(chave, valor);
  }
  busca.set('tela', 'voz');
  redirect(`/agente/${encodeURIComponent(slug)}?${busca}`);
}
