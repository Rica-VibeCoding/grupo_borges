// ⚠️ ESTE ARQUIVO É OBRIGATÓRIO. Não remover "porque o apps/web não tem".
//
// O apps/web não tem, e por isso o Tailwind NUNCA rodou nele — o CSS servido de lá
// tem 278 KB de tema artesanal, `@theme` literal e ZERO classe utilitária. Ele
// funciona só porque não depende de utilitária nenhuma. Eu inferi da ausência do
// arquivo que "o Next 16 processa `@import tailwindcss` nativamente" e estava
// errado; a auditoria de frontend (Kimi, 30/07) pegou, e o `stack.md` §5 foi
// corrigido.
//
// Sintoma quando falta: **nada de erro.** O CSS compila, o app sobe, e as classes
// simplesmente não existem — `flex` não faz coluna, `hidden md:block` não esconde
// nada, e as três superfícies viram uma pilha só no celular. Verificar sempre pela
// SAÍDA, nunca pela presença do import:
//
//   curl -s "localhost:3008$(curl -s localhost:3008/ | grep -oE '/_next/[^"]*globals[^"]*\.css' | head -1)" \
//     | grep -cE '\.flex[ {,:]'
//
// Zero = o engine não rodou. Com engine, o CSS passa de ~4 KB para ~11 KB, ganha
// preflight (`box-sizing`) e os `@media (min-width: 48rem)`, e o `@theme inline`
// desaparece (é consumido, não servido).
//
// ⚠️ TROQUEI ESTE ARQUIVO E NADA MUDOU? O `.next` guarda o transform de PostCSS
// compilado e **mascara a mudança de config em silêncio**. Foi o que me fez perseguir
// três hipóteses erradas antes de achar a certa — inclusive declarar o plugin no
// package.json da raiz, que **depois medi e NÃO é necessário** (testei sem, do zero:
// segue 200 com 10.993 bytes). Ao mexer aqui: derrubar o dev pelo PID da porta,
// mover o `.next`, subir de novo.
//
// Versão casada de propósito com o `tailwindcss` do package.json (4.3.0): plugin e
// engine desalinhados é a próxima classe de bug silencioso.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
