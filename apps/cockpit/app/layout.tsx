import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata, Viewport } from 'next';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { FrotaProvider } from '@/components/shell/frota-provider';
import { geistMono, geistSans } from './fonts';
import './globals.css';

const APPLE_TOUCH_ICON = `data:image/png;base64,${readFileSync(
  join(process.cwd(), 'public/apple-touch-icon.png'),
).toString('base64')}`;

export const metadata: Metadata = {
  title: 'Cockpit — Grupo Borges',
  description: 'Painel da frota. Log de execução que às vezes conversa.',
  // Sem isto o iOS ignora `display: 'standalone'` do manifest: quem instala
  // pela tela inicial abre em aba do Safari, com a barra de baixo — o WebKit
  // só entra em modo app pela meta tag `apple-mobile-web-app-capable`
  // (`developer.apple.com/library/.../ConfiguringWebApplications`), o
  // manifest.json sozinho não basta nele.
  //
  // O `apple-touch-icon` vai EMBUTIDO no href (`data:`), não como arquivo: o
  // iPhone (iOS 27.2) baixa o ícone deste endereço com 200 e mesmo assim põe a
  // inicial "C" na tela "Adicionar à Tela de Início" — medido em 12/10/2026
  // com página mínima, PNG de outro site e ícone em host público; só o
  // embutido apareceu.
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: APPLE_TOUCH_ICON, sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Cockpit',
    statusBarStyle: 'black-translucent',
  },
  // O Safari do iPhone marca sozinho telefone, data, e-mail e endereço no texto
  // (horários do chat inclusive) antes do React hidratar: vira atributo que o
  // servidor não mandou e o React acusa hydration mismatch.
  formatDetection: { telephone: false, date: false, email: false, address: false },
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
