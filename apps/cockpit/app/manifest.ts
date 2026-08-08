import type { MetadataRoute } from 'next';

// `scope: '/'` cobre tanto `/` quanto `/agente/[slug]`: o Rica pode instalar o
// ícone estando em qualquer uma das duas, e ela precisa navegar entre as duas
// sem cair pra fora do modo standalone (o WebKit troca pra Safari View
// Controller quando a navegação sai do scope). `start_url: '/'` é a tela da
// frota, não uma rota de agente específica — é o que faz sentido como
// destino de um toque a frio no ícone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Grupo Borges — Cockpit',
    short_name: 'Cockpit',
    description: 'Painel da frota. Log de execução que às vezes conversa.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#191919',
    theme_color: '#191919',
    icons: [
      {
        src: '/icon.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
