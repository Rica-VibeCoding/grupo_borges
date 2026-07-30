/**
 * Geist Sans + Geist Mono, auto-hospedadas.
 *
 * Contrato de estética §4. Três decisões que NÃO são gosto:
 *
 * 1. `next/font/local`, não CDN. Quem serve é a VPS e o cockpit é acessado pelo
 *    tailnet — fonte em rede externa é ponto único de falha fora do nosso
 *    controle.
 * 2. `display: 'optional'`, não o default `swap`. `swap` pinta na fonte de
 *    sistema e TROCA depois, e a troca reflui a página inteira. Num log que está
 *    streamando isso é exatamente o que o item 2 do gate proíbe. `optional` dá
 *    ~100ms de bloqueio e nunca troca: o pior caso é uma carga em fonte de
 *    sistema, não um reflow no meio do stream.
 * 3. Os dois arquivos variáveis, e só eles: 137,7 KB somados (pesados, não
 *    estimados). O pacote `geist` traz 45 woff2 e 2,1 MB, mas importar dele
 *    fixaria os parâmetros acima — inclusive o `swap`.
 *
 * `subset` não entra: a tabela do next/font marca `subsets` como suportado em
 * `font/google` e NÃO em `font/local` — subsetting é do pipeline do Google.
 */
import localFont from 'next/font/local';

export const geistSans = localFont({
  src: './fonts/Geist-Variable.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'optional',
  preload: true,
});

export const geistMono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'optional',
  preload: true,
});
