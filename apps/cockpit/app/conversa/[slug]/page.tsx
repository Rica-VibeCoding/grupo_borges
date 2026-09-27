import { redirect } from 'next/navigation';

/**
 * A conversa por voz mora no pager da página do agente, ao lado do chat (fase 3): a mesma
 * página, montada uma vez. Esta rota é só a entrada direta — leva ao pager com a voz primeiro,
 * e o pager devolve a URL para `/conversa/{slug}` sem navegar.
 */
export default async function ConversaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/agente/${encodeURIComponent(slug)}?tela=voz`);
}
