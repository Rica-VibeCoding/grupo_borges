import { redirect } from 'next/navigation';

// A tela se chama pelo que faz (Rica, 05/11): `/maquinas` virou `/abertos`.
// Fica só o desvio, com a aba (`?m=`) junto.
export default async function Maquinas({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  redirect(m ? `/abertos?m=${encodeURIComponent(m)}` : '/abertos');
}
