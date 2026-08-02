// FUZZ da janela de absorção — a prova da investigação de 02/08, quando o
// print do Rica mostrou DOIS grupos azuis (em voo) na mesma corrida e a
// hipótese era a janela rachar o grupo com item ainda em voo.
//
// Conclusão: NÃO racha — 300 streams sintéticas com flushes de tamanho
// aleatório, resultados chegando em mensagens separadas e fora de ordem,
// thinkings (ocos e com texto), narração e falas do Rica intercaladas, e o
// incremental é idêntico ao rebuild completo em TODOS os prefixos. Os dois
// azuis do print são outra coisa: o split é legítimo (há linha visível entre
// os grupos) e o grupo mais velho fica azul porque tem execução ÓRFÃ — um
// tool_use cujo resultado nunca chegou (turno interrompido entre a chamada e
// o resultado). Como o lookup cobre o histórico inteiro, resultado que chega
// depois APAGA o azul retroativamente; o azul que sobra é o do resultado que
// nunca existiu.
//
// O teste fica de pé como rede de regressão da janela: se alguém quebrar a
// absorção, algum seed diverge.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  buildRenderItems,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

import { agrupaFerramentas } from '../../components/feed/grupo-ferramentas.ts';
import { temConteudoVisivel } from './conteudo-visivel.ts';
import { createIncrementalRenderItems } from './render-items-incremental.ts';

function full(messages: readonly MessagePayload[]) {
  return agrupaFerramentas(
    coalesceSidechainGroups(buildRenderItems([...messages]).filter(temConteudoVisivel)),
  );
}

let proximoId = 1;
function base(kind: string, role: string | null, content: unknown): MessagePayload {
  return {
    id: proximoId++,
    kind,
    uuid: `fz-${proximoId}`,
    parent_uuid: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-08-02T00:00:00Z',
    created_at: 0,
    message: role === null ? null : { role, content },
  } as unknown as MessagePayload;
}

// Gerador determinístico (mulberry32) — falha tem de ser reproduzível.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Evento =
  | { tipo: 'tool'; tu: string; nome: string }
  | { tipo: 'resultado'; tu: string; grande: boolean }
  | { tipo: 'thinking-oco' }
  | { tipo: 'thinking-real' }
  | { tipo: 'texto' }
  | { tipo: 'usuario' };

function materializa(evento: Evento): MessagePayload {
  switch (evento.tipo) {
    case 'tool':
      return base('assistant', 'assistant', [
        { type: 'tool_use', id: evento.tu, name: evento.nome, input: { command: `cmd ${evento.tu}` } },
      ]);
    case 'resultado':
      return base('user', 'user', [
        {
          type: 'tool_result',
          tool_use_id: evento.tu,
          content: evento.grande ? 'saida '.repeat(80) : 'ok',
        },
      ]);
    case 'thinking-oco':
      return base('assistant', 'assistant', [{ type: 'thinking', thinking: ' \n' }]);
    case 'thinking-real':
      return base('assistant', 'assistant', [{ type: 'thinking', thinking: 'hmm, e se…' }]);
    case 'texto':
      return base('assistant', 'assistant', [{ type: 'text', text: 'vou continuar' }]);
    case 'usuario':
      return base('user', 'user', [{ type: 'text', text: 'recado do rica' }]);
  }
}

function geraStream(rand: () => number): MessagePayload[] {
  const mensagens: MessagePayload[] = [];
  let ferramentas = 0;
  const pendentes: string[] = [];
  const total = 40 + Math.floor(rand() * 40);
  for (let i = 0; i < total; i++) {
    const sorteio = rand();
    if (sorteio < 0.45) {
      const tu = `tu-${ferramentas++}`;
      pendentes.push(tu);
      mensagens.push(materializa({ tipo: 'tool', tu, nome: rand() < 0.7 ? 'Bash' : 'Read' }));
    } else if (sorteio < 0.8 && pendentes.length > 0) {
      // Resultado do mais velho (FIFO) ou de um aleatório (paralelo fora de ordem).
      const indice = rand() < 0.7 ? 0 : Math.floor(rand() * pendentes.length);
      const [tu] = pendentes.splice(indice, 1);
      mensagens.push(materializa({ tipo: 'resultado', tu: tu!, grande: rand() < 0.3 }));
    } else if (sorteio < 0.87) {
      mensagens.push(materializa({ tipo: 'thinking-oco' }));
    } else if (sorteio < 0.92) {
      mensagens.push(materializa({ tipo: 'thinking-real' }));
    } else if (sorteio < 0.96) {
      mensagens.push(materializa({ tipo: 'texto' }));
    } else {
      mensagens.push(materializa({ tipo: 'usuario' }));
    }
  }
  return mensagens;
}

let falhas = 0;
for (let seed = 1; seed <= 300; seed++) {
  const rand = rng(seed);
  const stream = geraStream(rand);
  const incremental = createIncrementalRenderItems();
  let pos = 0;
  while (pos < stream.length) {
    // Flush de tamanho aleatório: 1..4 mensagens por vez, como o SSE real.
    pos += 1 + Math.floor(rand() * 4);
    const prefixo = stream.slice(0, Math.min(pos, stream.length));
    const obtido = JSON.stringify(incremental.update(prefixo));
    const esperado = JSON.stringify(full(prefixo));
    if (obtido !== esperado) {
      falhas++;
      console.log(`seed ${seed} prefixo ${prefixo.length}/${stream.length}: DIVERGIU`);
      const o = incremental.update(prefixo).map((i) => i.kind);
      const e = full(prefixo).map((i) => i.kind);
      console.log('  incremental:', JSON.stringify(o));
      console.log('  completo   :', JSON.stringify(e));
      if (falhas > 5) break;
    }
  }
  if (falhas > 5) break;
}
console.log(falhas === 0 ? 'OK — 300 seeds sem divergência' : `${falhas} FALHAS`);

test('a janela de absorção nunca diverge do rebuild completo (300 seeds)', () => {
  assert.equal(falhas, 0);
});
