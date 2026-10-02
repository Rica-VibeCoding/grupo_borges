import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';

// 8002 e NÃO 8000 — a 8000 desta VPS é do Coolify. Este default é o que sobra
// quando alguém roda `next build` sem exportar `API_BACKEND_URL`, e o destino do
// rewrite é gravado no `.next/routes-manifest.json` NA COMPILAÇÃO: o
// `Environment=` da unit systemd só vale pro processo de runtime, chega tarde.
// Com o número errado aqui, o cockpit inteiro passa a bater no Coolify — painel
// respondendo "não consegui ler os controles", feed vazio — e o build sai VERDE.
// Foi assim que a 3446 caiu em 06/09.
const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';

/**
 * A FALHA BARULHENTA — quem confere o endereço é o BUILD, porque é ele que grava.
 *
 * A régua é o CORPO da resposta, não o código: a 8000 desta VPS está de pé e
 * responde: um teste de "porta aberta" (ou de 2xx) passaria verde no endereço
 * errado, que é exatamente o que aconteceu em 06/09. `grupo_borges-api` é a
 * assinatura que só a nossa API devolve.
 *
 * Aborta em vez de avisar. Aviso em log de build é o que ninguém lê — o build de
 * 06/09 saiu VERDE e quem descobriu foi o Rica, pelo painel morto no celular.
 *
 * `COCKPIT_BUILD_SEM_BACKEND=1` pula, pro build de verificação em máquina que não
 * alcança a API (`docs/cockpit-v2-playbook.md`). Pular é escolha declarada; o
 * silêncio de antes não era.
 */
function exigeBackendVivo(base: string): void {
  if (process.env.COCKPIT_BUILD_SEM_BACKEND === '1') return;

  const alvo = `${base}/health`;
  const origem = process.env.API_BACKEND_URL ? 'API_BACKEND_URL' : 'default deste arquivo';
  const comoConsertar =
    `  Endereço em uso: ${base}  (${origem})\n` +
    `  É ele que vai ser gravado no rewrite do bundle — errado aqui, o cockpit\n` +
    `  inteiro bate no lugar errado com o build passando verde.\n\n` +
    `  Conferir a API:  systemctl --user status cockpit-api.service\n` +
    `  Build sem back:  COCKPIT_BUILD_SEM_BACKEND=1 pnpm build\n`;

  let corpo: string;
  try {
    corpo = execFileSync('curl', ['-fsS', '--max-time', '5', alvo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(`\n\n  BUILD ABORTADO — ${alvo} não respondeu.\n\n${comoConsertar}`);
  }

  if (!corpo.includes('grupo_borges-api')) {
    throw new Error(
      `\n\n  BUILD ABORTADO — ${alvo} respondeu, mas NÃO é a nossa API.\n` +
        `  (devolveu: ${corpo.slice(0, 120).replace(/\s+/g, ' ').trim()})\n\n${comoConsertar}`,
    );
  }
}

/**
 * O ID DE DEPLOY — o anti-version-skew. Rebuild publicado com a aba do Rica
 * aberta deixava o bundle antigo em memória referenciando chunk hasheado que
 * não existe mais: o seletor de foto morria e o clique de enviar não disparava
 * requisição nenhuma (zero POST /file no log da API, 08/08 noite). Com o
 * `deploymentId` o Next injeta o ID nos assets estáticos, nas respostas de
 * navegação e no `data-dpl-id` do `<html>`; o cliente que detectar divergência
 * força reload completo sozinho — sem o Rica saber que precisa de F5. Doc:
 * self-hosting.mdx (Version Skew), conferido via Context7 na 16.2.9. O BUILD_ID
 * NÃO ajuda aqui: é o mesmo em todo build desde 10/09.
 *
 * O id muda quando o BUNDLE pode ter mudado, e só aí. Até 28/09 era o
 * `git rev-parse --short HEAD`: commit de doc, da API ou de outro agente
 * trocava o id e a aba do Rica recarregava inteira no toque seguinte. Agora é o
 * hash das árvores git do que o build lê (`ENTRADAS_DO_BUILD`). Árvore suja
 * nessas entradas — WIP que entra no bundle e que o hash do commit não vê —
 * ganha sufixo único: nunca repete id com conteúdo diferente.
 *
 * O `next start` REAVALIA este arquivo. Recalcular lá seria errado: com vários
 * agentes commitando, um commit no cockpit entre o build e o start daria ao
 * servidor um id que o bundle não tem. Por isso o start LÊ o id que o build
 * gravou: o Next escreve a config resolvida, `deploymentId` junto, em
 * `<distDir>/required-server-files.json` (build/index.js:218 da 16.2.6), e o
 * arquivo viaja com o diretório quando o estágio vira `.next`. Resolve-se pelo
 * distDir DO START — o caminho do estágio gravado lá dentro é ignorado.
 */
const DIST_DIR = process.env.COCKPIT_DIST_DIR ?? '.next';

// Relativo à raiz do repo. Fora daqui o build não lê nada que vá pro bundle:
// o core entra como source (`transpilePackages`), versão de lib vem do lockfile,
// e env só vira bundle com prefixo NEXT_PUBLIC_, que o cockpit não usa.
export const ENTRADAS_DO_BUILD = [
  'apps/cockpit',
  'packages/cockpit-core',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
];
// Sujeira que não muda o bundle. O `next build`/`next dev` reescreve o `include`
// do tsconfig a cada distDir novo (vive sujo no repo principal), e o próprio
// diretório de estágio nasce fora do .gitignore — contá-lo daria `-wip` a todo
// build feito com um estágio anterior ainda no disco.
const SUJEIRA_QUE_NAO_CONTA = [
  ':(exclude)apps/cockpit/tsconfig.json',
  ':(exclude,glob)apps/cockpit/.next*/**',
];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function idDoCodigo(cwd: string = process.cwd()): string {
  const unico = Date.now().toString(36);
  try {
    const raiz = git(['rev-parse', '--show-toplevel'], cwd);
    const arvores = git(['rev-parse', ...ENTRADAS_DO_BUILD.map((p) => `HEAD:${p}`)], raiz);
    const sujos = git(
      [
        'status', '--porcelain', '--untracked-files=all', '--',
        ...ENTRADAS_DO_BUILD,
        ...SUJEIRA_QUE_NAO_CONTA,
      ],
      raiz,
    );
    const id = createHash('sha256').update(arvores).digest('hex').slice(0, 12);
    return sujos ? `${id}-wip${unico}` : id;
  } catch {
    // Sem `.git` (build fora do repo): único por build, o requisito de variar
    // quando o código muda continua de pé.
    return `semgit${unico}`;
  }
}

export function idGravadoNoBuild(pastaDoBuild: string): string | undefined {
  try {
    const manifesto = JSON.parse(readFileSync(join(pastaDoBuild, 'required-server-files.json'), 'utf8'));
    const id = manifesto?.config?.deploymentId;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

// O Next avalia a config mais de uma vez por build, inclusive em processo
// filho. Com árvore suja o sufixo é único POR AVALIAÇÃO — sem memória, um
// mesmo build sairia com dois ids. A env herda para os filhos.
function idDoCodigoDoProcesso(): string {
  process.env.__COCKPIT_ID_DO_CODIGO ??= idDoCodigo();
  return process.env.__COCKPIT_ID_DO_CODIGO;
}

function idDoDeploy(phase: string): string {
  if (phase !== PHASE_PRODUCTION_SERVER) return idDoCodigoDoProcesso();
  const gravado = idGravadoNoBuild(join(process.cwd(), DIST_DIR));
  if (gravado) return gravado;
  // Build sem o manifesto: o start sobe mesmo assim, com o comportamento antigo.
  console.warn(`[cockpit] ${DIST_DIR}/required-server-files.json sem deploymentId — id recalculado no start`);
  return idDoCodigoDoProcesso();
}

// Exportado à parte do default: o `anexo.test.ts` amarra o teto do vídeo ao
// `proxyClientMaxBodySize` daqui, e precisa LER a config sem executar a fase — se
// tivesse de chamar a função, o teste passaria a depender da API estar de pé.
export const config: NextConfig = {
  devIndicators: false,

  // ⚠️ O DEV NÃO DIVIDE DIRETÓRIO DE BUILD COM A PRODUÇÃO. O `next start` da
  // 3008 roda a partir deste mesmo `apps/cockpit` e serve `.next/`; um
  // `next dev` apontado pra cá — ou uma faxina de `.next` pra destravar o
  // Turbopack — deixa a produção devolvendo 500 em todo chunk estático, com o
  // HTML ainda em 200 (o servidor já está em memória). Foi assim que a 3008 caiu
  // em 04/08. Dev sobe com `COCKPIT_DIST_DIR=.next-dev`; a produção não define a
  // variável e continua em `.next`.
  distDir: DIST_DIR,

  // O core é consumido como SOURCE (subpath exports apontando pra .ts), sem build
  // step. É isto que transpila.
  transpilePackages: ['@grupo_borges/cockpit-core'],

  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.tailfe77db.ts.net',
    '100.107.56.38',
  ],

  // gzip do `next start` em HTML, JS, CSS e JSON — nenhuma outra camada comprime
  // (o `tailscale serve` não comprime e não há nginx). ⚠️ SSE NÃO PODE sair
  // comprimido: o zlib segura os eventos pequenos e o cliente vê o replay em
  // rajada e nunca recebe heartbeat nem live — parece bug de protocolo, é gzip.
  // A compressão pula resposta com `Cache-Control: no-transform`, e esse
  // cabeçalho NÃO dá para pôr pelo `headers()` numa rota do `rewrites()`: o proxy
  // copia por cima o `Cache-Control` da API. Por isso todo stream da API tem
  // route handler próprio em `app/api/**` (via `lib/repasse-sse.ts`) e não passa
  // pelo rewrite. Stream novo na API sem route handler chega comprimido.
  // docs/cockpit-v2-stack.md §4.
  compress: true,

  // ⚠️ O TETO DE 100MB DO VÍDEO MORA AQUI TAMBÉM, não só no backend. O Next
  // BUFFERIZA o corpo da requisição quando faz proxy, e o default é 10MB: acima
  // disso ele trunca, loga "Request body exceeded 10MB" e o FastAPI recebe um
  // multipart cortado — o socket cai (`ECONNRESET`) e o cliente vê 500. Sem esta
  // linha o teto de 100MB da rota `/file` é ficção: foto e documento passam
  // porque cabem em 10MB, vídeo de celular nunca passa. Foi o que travou o Rica
  // em 04/08 com um .mov do iPhone.
  //
  // O nome é `proxyClientMaxBodySize`. O `middlewareClientMaxBodySize` que a
  // mensagem de erro do Next sugere está DEPRECADO nesta versão (16.2.6) e os
  // dois juntos lançam E879 — conferido no `config.js:162` e `:616` da própria
  // instalação, além da doc.
  //
  // 60MB, e o número tem dono: o Next bufferiza o corpo INTEIRO em memória para
  // permitir múltiplas leituras, e o limite é POR REQUISIÇÃO, não global. Esta
  // VPS tem 7GB e já travou por consumo — 100MB aqui seriam 200MB de buffer com
  // dois uploads ao mesmo tempo. Por isso o teto de vídeo do backend caiu para
  // 50MB (`agents.py`, `_VIDEO_MAX_BYTES`) e a folga de 10MB cobre as bordas e a
  // legenda do multipart.
  //
  // TRÊS NÚMEROS ANDAM JUNTOS: este, o `_VIDEO_MAX_BYTES` do backend e o
  // `tetoBytes` de `lib/anexo.ts`. Mexer em um sozinho recria o bug de 04/08 —
  // a tela prometendo tamanho que o transporte não entrega.
  experimental: {
    proxyClientMaxBodySize: '60mb',
  },

  // O front não fala com o FastAPI por URL absoluta: chama /api/... no próprio
  // host e o Next faz o proxy. É isso que faz o SSE atravessar o Tailscale sem
  // CORS e sem porta extra exposta.
  //
  // `fallback`, e não a lista simples (= `afterFiles`): o `afterFiles` vence as
  // rotas DINÂMICAS do app, e os route handlers de stream em
  // `app/api/agents/[slug]/…` nunca seriam alcançados (ver `compress` acima).
  // No `fallback` o proxy só pega o que nenhuma rota do app atendeu.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        { source: '/api/:path*', destination: `${API_BASE}/api/:path*` },
        { source: '/uploads/agents/:path*', destination: `${API_BASE}/uploads/agents/:path*` },
      ],
    };
  },
};

// Forma de função pra enxergar a `phase`: a checagem tem de rodar SÓ no
// `next build`. Em `next start` ela transformaria uma API momentaneamente fora do
// ar em cockpit que não sobe — trocaria uma tela quebrada por nenhuma tela.
export default (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_BUILD) exigeBackendVivo(API_BASE);
  return { ...config, deploymentId: idDoDeploy(phase) };
};
