import { fetchAgent } from '@grupo_borges/cockpit-core/api';
import { notFound } from 'next/navigation';

import { TelaConversa } from '@/components/conversa/tela-conversa';

export const dynamic = 'force-dynamic';

export default async function ConversaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agente = await fetchAgent(slug);
  if (!agente) notFound();

  return <TelaConversa key={agente.slug} slug={agente.slug} nome={agente.name} />;
}
