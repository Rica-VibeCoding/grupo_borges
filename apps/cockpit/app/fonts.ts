/**
 * Geist Sans + Geist Mono, auto-hospedadas.
 *
 * Contrato de estética §4. Três decisões que NÃO são gosto:
 *
 * 1. `next/font/local`, não CDN. Quem serve é a VPS e o cockpit é acessado pelo
 *    tailnet — fonte em rede externa é ponto único de falha fora do nosso
 *    controle.
 * 2. `display: 'fallback'`, e este valor foi MEDIDO, não escolhido por leitura
 *    da spec. O contrato pedia `optional` para nunca refluir durante o stream;
 *    o defeito é que `optional` tem janela de bloqueio de ~100ms e período de
 *    troca ZERO — perdeu a janela, a página inteira fica em fonte de sistema
 *    para sempre naquela carga, e o browser não volta atrás mesmo com a fonte
 *    já baixada (`document.fonts` chega a reportá-la como `loaded`).
 *
 *    Medido em 5 cargas de cache limpo por rota: a Geist entrava em 3/5 na `/`
 *    e 2/5 na rota do agente. Não é degradação graciosa, é sorteio — e a §4 do
 *    contrato elege a fonte como decisão tipográfica central.
 *
 *    `fallback` mantém os MESMOS ~100ms de bloqueio (não acrescenta um piscar
 *    de texto invisível) e abre uma janela de troca de ~3s. O reflow que o
 *    contrato temia acontece na CARGA, antes de existir stream na tela — e a
 *    alternativa medida era a tela do Rica em fonte de sistema metade das
 *    vezes. `swap` continua fora: janela de troca infinita reflui a página
 *    depois de qualquer tempo, e aí sim cai no item 2 do gate.
 *
 *    O `adjustFontFallback` fica no default (`'Arial'`): é ele que dá métricas
 *    ajustadas à face de fallback e encolhe o deslocamento da troca.
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
  display: 'fallback',
  preload: true,
});

export const geistMono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'fallback',
  preload: true,
});
