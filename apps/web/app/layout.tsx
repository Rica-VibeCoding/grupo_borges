import type { Metadata, Viewport } from 'next';
import { SseProvider } from '../components/sse-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grupo Borges — Cockpit',
  description: 'Cockpit operacional do Grupo Borges',
  appleWebApp: {
    capable: true,
    title: 'Cockpit',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A1628',
  width: 'device-width',
  initialScale: 1,
  // Quando teclado virtual abre no iOS Safari, o default `resizes-visual`
  // mantém o layout viewport intacto e iOS faz scroll-into-view do input
  // focado — empurra header/tabs pra fora da tela. `resizes-content` faz
  // o LAYOUT viewport reduzir junto com o teclado: 100dvh acompanha,
  // .agent-modal-frame-mobile encolhe, conteúdo todo permanece visível.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="/theme-restore.js" />
      </head>
      <body data-sse="on" data-load="off">
        <SseProvider>{children}</SseProvider>
      </body>
    </html>
  );
}
