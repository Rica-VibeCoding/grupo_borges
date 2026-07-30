import type { Metadata, Viewport } from 'next';
import { geistMono, geistSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cockpit — Grupo Borges',
  description: 'Painel da frota. Log de execução que às vezes conversa.',
};

export const viewport: Viewport = {
  // themeColor tem de bater com --ck-surface-canvas. Se o token mudar, este
  // valor muda junto — é o que impede a barra do Safari de destoar do palco.
  themeColor: '#18191d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Sem isto o iPhone não entrega env(safe-area-inset-*), e os tokens
  // --ck-safe-* resolvem para 0 em cima do notch.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // As duas classes publicam --font-geist-sans e --font-geist-mono, que são o
    // que os tokens --ck-font-* consomem. Sem elas os tokens caem no fallback de
    // sistema em silêncio: a tela renderiza, só não é a fonte do contrato.
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
