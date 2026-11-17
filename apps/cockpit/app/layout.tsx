import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata, Viewport } from 'next';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { FrotaProvider } from '@/components/shell/frota-provider';
import { frotaInicialDoCliente } from '@/lib/frota-inicial-do-cliente';
import { MODO_CLIENTE, NOMES } from '@/lib/modo';
import { leSessao } from '@/lib/sessao-do-portao';
import { geistMono, geistSans } from './fonts';
import './globals.css';

/** O PNG de 180 px como `data:`. O iPhone (iOS 27.2) baixa o ícone por
 *  endereço com 200 e mesmo assim salva a inicial do nome em "Adicionar à Tela
 *  de Início"; só o embutido aparece — medido em 12/10/2026
 *  (`daniel/docs/pegadinhas/icone-iphone-tela-de-inicio.md`). */
function iconeEmbutido(arquivo: string): string {
  return `data:image/png;base64,${readFileSync(join(process.cwd(), 'public', arquivo)).toString('base64')}`;
}

/** O ícone do agente logado (`public/icones/<slug>.png`) ou o padrão. Só o
 *  painel do cliente tem sessão; slug fora do formato não vira caminho. */
async function iconeDaTelaDeInicio(): Promise<string> {
  const slug = MODO_CLIENTE ? (await leSessao())?.slug : null;
  if (slug && /^[a-z0-9-]+$/.test(slug) && existsSync(join(process.cwd(), 'public/icones', `${slug}.png`))) {
    return iconeEmbutido(`icones/${slug}.png`);
  }
  return iconeEmbutido('apple-touch-icon.png');
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: NOMES.titulo,
    description: NOMES.descricao,
    // Sem isto o iOS ignora `display: 'standalone'` do manifest: quem instala
    // pela tela inicial abre em aba do Safari, com a barra de baixo — o WebKit
    // só entra em modo app pela meta tag `apple-mobile-web-app-capable`
    // (`developer.apple.com/library/.../ConfiguringWebApplications`), o
    // manifest.json sozinho não basta nele.
    //
    // Declarar `icons` desliga a convenção de arquivo do Next: o `icon` vai junto.
    icons: {
      icon: [{ url: '/icon.png', sizes: '1024x1024', type: 'image/png' }],
      apple: [{ url: await iconeDaTelaDeInicio(), sizes: '180x180', type: 'image/png' }],
    },
    appleWebApp: {
      capable: true,
      title: NOMES.nomeCurto,
      statusBarStyle: 'black-translucent',
    },
    // O Safari do iPhone marca sozinho telefone, data, e-mail e endereço no texto
    // (horários do chat inclusive) antes do React hidratar: vira atributo que o
    // servidor não mandou e o React acusa hydration mismatch.
    formatDetection: { telephone: false, date: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  // themeColor tem de bater com --ck-surface-canvas. Se o token mudar, este
  // valor muda junto — é o que impede a barra do Safari de destoar do palco.
  themeColor: '#191919',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Sem isto o iPhone não entrega env(safe-area-inset-*), e os tokens
  // --ck-safe-* resolvem para 0 em cima do notch.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Painel do cliente: a "frota" é o agente da sessão (`lib/frota-do-cliente.ts`).
  const fleet = MODO_CLIENTE ? await frotaInicialDoCliente() : await fetchFleet();
  return (
    // As duas classes publicam --font-geist-sans e --font-geist-mono, que são o
    // que os tokens --ck-font-* consomem. Sem elas os tokens caem no fallback de
    // sistema em silêncio: a tela renderiza, só não é a fonte do contrato.
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <FrotaProvider initialFleet={fleet}>{children}</FrotaProvider>
      </body>
    </html>
  );
}
