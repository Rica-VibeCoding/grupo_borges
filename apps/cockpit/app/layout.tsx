import type { Metadata, Viewport } from 'next';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { FrotaProvider } from '@/components/shell/frota-provider';
import { geistMono, geistSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cockpit — Grupo Borges',
  description: 'Painel da frota. Log de execução que às vezes conversa.',
  // Sem isto o iOS ignora `display: 'standalone'` do manifest: quem instala
  // pela tela inicial abre em aba do Safari, com a barra de baixo — o WebKit
  // só entra em modo app pela meta tag `apple-mobile-web-app-capable`
  // (`developer.apple.com/library/.../ConfiguringWebApplications`), o
  // manifest.json sozinho não basta nele. `app/apple-icon.png` cobre o
  // `apple-touch-icon` — convenção de arquivo do Next, sem precisar de <link>
  // manual.
  appleWebApp: {
    capable: true,
    title: 'Cockpit',
    statusBarStyle: 'black-translucent',
  },
};

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
  const fleet = await fetchFleet();
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
