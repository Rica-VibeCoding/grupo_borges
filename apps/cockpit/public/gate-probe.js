/* ===========================================================================
 * gate-probe.js — instrumento de medição do gate do passo 5
 *
 * Contrato: docs/cockpit-v2-gate.md §4 e §5. Ownership: docs/cockpit-v2-ownership.md
 * §5.2 (cedido ao Daniel nesta rodada). DESCARTÁVEL POR CONTRATO: não entra em
 * bundle de produção, não é importado por componente nenhum, ninguém constrói
 * feature em cima disto.
 *
 * Mede G1..G4 e exporta em JSON. Roda em Safari iOS e roda TAMBÉM no painel
 * antigo da 3007, por bookmarklet, sem tocar uma linha de apps/web — sem isso
 * não existe baseline e o gate não fecha.
 *
 * ---------------------------------------------------------------------------
 * COMO INSTALAR
 *
 *   No v2 (3008), em desenvolvimento:
 *     <script src="/gate-probe.js"></script>
 *
 *   No painel antigo (3007), pelo Safari do iPhone — bookmarklet, uma linha:
 *     javascript:(function(){var s=document.createElement('script');
 *     s.src='http://SEU-HOST:3008/gate-probe.js';document.body.appendChild(s)})()
 *
 *   `<script src>` clássico não passa por CORS, então carregar de 3008 dentro da
 *   página da 3007 funciona; o que bloquearia é CSP, e o apps/web não define
 *   nenhuma (verificado em 30/07).
 *
 * ---------------------------------------------------------------------------
 * PARÂMETROS  (nenhum seletor é hardcoded — §"não hardcoda" do pedido)
 *
 *   Por query string no src:  /gate-probe.js?sel=%23feed&msg=.bolha&dur=60&auto=1
 *   Ou antes de carregar:     window.GATE_PROBE_CONFIG = { seletor: '#feed' }
 *
 *   sel   seletor do container que ROLA. Default '[data-gate-messages]'.
 *   msg   seletor do nó de mensagem.     Default '[data-gate-message]'.
 *   dur   duração da janela em segundos. Default 60 (contrato §3).
 *   auto  '1' começa a medir sozinho ao carregar. Default: espera o toque.
 *
 *   Sem nenhum dos dois seletores o probe se vira: detecta o maior elemento
 *   rolável da página, e o botão "Alvo" deixa escolher com o dedo. O painel
 *   antigo não tem marcador nenhum no scroller, então essa via não é conforto,
 *   é a única que funciona lá.
 *
 *   PEDIDO AO DONO DO apps/cockpit: quando o feed do passo 5 nascer, marcar o
 *   scroller com `data-gate-messages` e cada mensagem com `data-gate-message`.
 *   Com os dois atributos a atribuição do G4 é exata; sem eles é heurística.
 *
 * ---------------------------------------------------------------------------
 * LIMITES QUE O NÚMERO CARREGA — declarados, não escondidos
 *
 * 1. Zero `PerformanceLongTaskTiming`, zero `performance.memory`: o Safari não
 *    implementa nenhum dos dois, e medir com instrumento que não existe no
 *    aparelho alvo é o mesmo que não medir (§4).
 * 2. `requestAnimationFrame` não roda com a aba escondida. Uma volta do app em
 *    segundo plano viraria um "frame de 40 s". O probe detecta a virada de
 *    visibilidade, DESCARTA aquele delta e conta a pausa em `pausas_aba`.
 * 3. "Caractere pintado" é aproximado pelo `setTimeout(0)` disparado de dentro
 *    do `requestAnimationFrame` do frame em que o texto mudou — é o pós-paint
 *    daquele frame. Não existe API de "pintou" no Safari; esta é a melhor
 *    aproximação sem devtools, e erra para MAIS (nunca reporta rápido demais).
 * 4. O G3 lê `getBoundingClientRect` da âncora a 4 Hz. Ler layout força reflow,
 *    então é 4 vezes por segundo e só enquanto o usuário está rolado para cima —
 *    de propósito, para o instrumento não sujar o G1 que ele mesmo mede.
 * 5. Cor em hex cru aqui dentro NÃO viola o §9.1 do contrato de estética: este
 *    arquivo tem de renderizar igual no painel antigo, onde os tokens `--ck-*`
 *    não existem. Instrumento descartável não usa o sistema de design.
 * ======================================================================== */

(function () {
  'use strict';

  if (window.__GATE_PROBE__) {
    window.__GATE_PROBE__.mostrar();
    return;
  }

  /* ---------------------------------------------------------------- config */

  var PADRAO = {
    seletor: '[data-gate-messages]',
    seletorMsg: '[data-gate-message]',
    duracaoMs: 60000,
    auto: false
  };

  var CORTES = {
    g1_p95_ms: 32,
    g1_pior_frame_ms: 250,
    g2_p95_ms: 100,
    g3_px: 0,
    g4_mutacoes_por_mensagem_selada: 2
  };

  function leConfig() {
    var c = {
      seletor: PADRAO.seletor,
      seletorMsg: PADRAO.seletorMsg,
      duracaoMs: PADRAO.duracaoMs,
      auto: PADRAO.auto
    };
    var g = window.GATE_PROBE_CONFIG;
    if (g) {
      if (g.seletor) c.seletor = g.seletor;
      if (g.seletorMsg) c.seletorMsg = g.seletorMsg;
      if (g.duracaoSegundos) c.duracaoMs = g.duracaoSegundos * 1000;
      if (g.auto) c.auto = true;
    }
    var s = document.currentScript;
    if (s && s.src && s.src.indexOf('?') !== -1) {
      var q = s.src.slice(s.src.indexOf('?') + 1).split('&');
      for (var i = 0; i < q.length; i++) {
        var par = q[i].split('=');
        var k = decodeURIComponent(par[0]);
        var v = decodeURIComponent(par[1] || '');
        if (k === 'sel' && v) c.seletor = v;
        if (k === 'msg' && v) c.seletorMsg = v;
        if (k === 'dur' && v) c.duracaoMs = parseFloat(v) * 1000;
        if (k === 'auto' && v === '1') c.auto = true;
      }
    }
    return c;
  }

  var CFG = leConfig();

  /* ------------------------------------------------------------- utilidades */

  var agora = function () { return performance.now(); };

  function percentil(a, q) {
    if (!a.length) return null;
    var o = a.slice().sort(function (x, y) { return x - y; });
    return o[Math.min(o.length - 1, Math.max(0, Math.ceil(o.length * q) - 1))];
  }

  function p95(a) { return percentil(a, 0.95); }

  function maior(a) {
    var m = 0;
    for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return a.length ? m : null;
  }

  function r2(n) { return n === null || n === undefined ? null : Math.round(n * 100) / 100; }

  function descreve(el) {
    if (!el) return null;
    var s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    if (cls) s += '.' + cls;
    var pai = el.parentElement;
    if (pai) s = pai.tagName.toLowerCase() + ' > ' + s;
    return s;
  }

  /* --------------------------------------------------- achar o que observar */

  function rolavel(el) {
    if (!el || el === overlay || (overlay && overlay.contains(el))) return false;
    if (el.scrollHeight - el.clientHeight < 80) return false;
    if (el.clientHeight < 120) return false;
    var ov = getComputedStyle(el).overflowY;
    return ov === 'auto' || ov === 'scroll';
  }

  // Sem marcador no DOM (caso do painel antigo) o critério é: entre os elementos
  // que realmente rolam, o que tem mais descendentes. Um feed de mensagens é, por
  // construção, o container mais povoado da tela.
  function detectaContainer() {
    var todos = document.querySelectorAll('*');
    var melhor = null, melhorPeso = -1;
    for (var i = 0; i < todos.length; i++) {
      var el = todos[i];
      if (!rolavel(el)) continue;
      var peso = el.getElementsByTagName('*').length;
      if (peso > melhorPeso) { melhorPeso = peso; melhor = el; }
    }
    return melhor;
  }

  function resolveContainer() {
    if (CFG.seletor) {
      var alvo = document.querySelector(CFG.seletor);
      if (alvo) return { el: alvo, origem: 'parametro' };
    }
    var auto = detectaContainer();
    if (auto) return { el: auto, origem: 'auto' };
    return { el: null, origem: 'nao-encontrado' };
  }

  // A "lista" é o elemento dentro do scroller que de fato tem os irmãos-mensagem.
  // Em geral existe um wrapper de largura de leitura entre o scroller e as bolhas.
  function achaLista(cont) {
    if (!cont) return null;
    var melhor = cont, melhorN = cont.childElementCount;
    var cand = cont.querySelectorAll('*');
    for (var i = 0; i < cand.length; i++) {
      var n = cand[i].childElementCount;
      if (n > melhorN) { melhorN = n; melhor = cand[i]; }
    }
    return melhor;
  }

  // Sobe do alvo da mutação até o filho direto da lista — esse é "a mensagem".
  function noDeMensagem(alvo) {
    var el = alvo.nodeType === 1 ? alvo : alvo.parentElement;
    if (!el || !lista) return null;
    if (CFG.seletorMsg) {
      var exato = el.closest ? el.closest(CFG.seletorMsg) : null;
      if (exato) return exato;
    }
    while (el && el.parentElement !== lista) {
      if (el === lista || el === document.body) return null;
      el = el.parentElement;
    }
    return el;
  }

  /* ------------------------------------------------------------------ estado */

  var rodando = false;
  var t0Sessao = 0, tFimSessao = 0;
  var container = null, lista = null, origemAlvo = 'nao-encontrado';
  var obs = null, rafId = 0, timerUI = 0, timerAncora = 0, timerFim = 0;

  var G1 = { deltas: [], pausasAba: 0 };
  var G2 = { amostras: [], semPintura: 0 };
  var G3 = { scrollPx: 0, ancoraPx: 0, eventos: 0, ancora: null, ancoraY: 0 };
  var G4 = { porNo: new Map(), ordem: [], ultima: null };

  function zera() {
    G1 = { deltas: [], pausasAba: 0 };
    G2 = { amostras: [], semPintura: 0 };
    G3 = { scrollPx: 0, ancoraPx: 0, eventos: 0, ancora: null, ancoraY: 0 };
    G4 = { porNo: new Map(), ordem: [], ultima: null };
  }

  /* --------------------------------------------- G1 — cadência entre frames */

  var ultimoFrame = 0;
  var pulaProximoDelta = false;

  function laco(t) {
    if (!rodando) return;
    if (ultimoFrame) {
      if (pulaProximoDelta) pulaProximoDelta = false;
      else G1.deltas.push(t - ultimoFrame);
    }
    ultimoFrame = t;
    rafId = requestAnimationFrame(laco);
  }

  function onVisibilidade() {
    if (!rodando) return;
    if (document.hidden) { G1.pausasAba++; }
    else { pulaProximoDelta = true; ultimoFrame = 0; }
  }

  /* ------------------------------------- G2 — keydown até o caractere pintado */

  function editavel(el) {
    if (!el) return false;
    var t = el.tagName;
    if (t === 'TEXTAREA') return true;
    if (t === 'INPUT') return /^(text|search|email|url|tel|password|)$/i.test(el.type || '');
    return el.isContentEditable === true;
  }

  function valorDe(el) {
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.textContent;
  }

  var MODIFICADORAS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, Tab: 1, Escape: 1 };

  function onKeydown(e) {
    if (!rodando) return;
    if (e.isComposing || e.keyCode === 229) return;          // IME: não é digitação direta
    if (MODIFICADORAS[e.key]) return;
    var alvo = e.target;
    if (!editavel(alvo)) return;

    var t0 = agora();
    var antes = valorDe(alvo);
    var frames = 0;

    (function esperaPintura() {
      requestAnimationFrame(function () {
        if (!rodando) return;
        if (valorDe(alvo) !== antes) {
          // setTimeout de dentro do rAF cai DEPOIS da pintura daquele frame.
          setTimeout(function () {
            var t1 = agora();
            G2.amostras.push({ ms: t1 - t0, t: t1 });
          }, 0);
          return;
        }
        if (++frames > 40) { G2.semPintura++; return; }       // ~660ms sem pintar: tecla morta
        esperaPintura();
      });
    })();
  }

  /* ------------------------------- G3 — a viewport se mexeu sem o dedo mandar */

  var gestoAte = 0;
  var ultimoScrollTop = 0;
  var estavaRoladoPraCima = false;

  function marcaGesto() {
    // 200ms de rabo: o scroll inercial do iOS chega depois do touchend.
    gestoAte = agora() + 200;
    G3.ancora = null;
  }

  function distanciaDoFim(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function onScroll() {
    if (!rodando || !container) return;
    var st = container.scrollTop;
    var d = st - ultimoScrollTop;
    // A decisão usa o estado ANTERIOR: se o app arranca a tela pro fim, no
    // momento do evento já estamos colados no fim e o teste "está rolado pra
    // cima?" responderia não — perdendo exatamente o caso que o G3 procura.
    if (estavaRoladoPraCima && agora() > gestoAte && d !== 0) {
      G3.scrollPx += Math.abs(d);
      G3.eventos++;
      // Zera a âncora: o mesmo pulo já foi contado pelo scrollTop, e a âncora
      // o veria de novo no próximo tique. Na bancada isso virava 272+272=544px
      // para um arranco só. A âncora existe para o que o scrollTop NÃO explica —
      // conteúdo inserido acima da viewport —, então ela recomeça daqui.
      G3.ancora = null;
    }
    ultimoScrollTop = st;
    estavaRoladoPraCima = distanciaDoFim(container) > 8;
  }

  // Conteúdo inserido ACIMA da viewport empurra a leitura sem mexer no
  // scrollTop. Só uma âncora visual pega isso.
  function mediAncora() {
    if (!rodando || !container || !lista) return;
    if (!estavaRoladoPraCima) { G3.ancora = null; return; }
    if (agora() < gestoAte) { G3.ancora = null; return; }

    var topo = container.getBoundingClientRect().top;
    if (!G3.ancora || !container.contains(G3.ancora)) {
      var filhos = lista.children;
      for (var i = 0; i < filhos.length; i++) {
        var r = filhos[i].getBoundingClientRect();
        if (r.bottom > topo) { G3.ancora = filhos[i]; G3.ancoraY = r.top; return; }
      }
      return;
    }
    var y = G3.ancora.getBoundingClientRect().top;
    var dy = y - G3.ancoraY;
    if (dy !== 0) { G3.ancoraPx += Math.abs(dy); G3.ancoraY = y; }
  }

  /* --------------------------------- G4 — mutações de DOM por nó de mensagem */

  function registra(no, selada) {
    if (!no) return;
    var e = G4.porNo.get(no);
    if (!e) { e = { antes: 0, depois: 0 }; G4.porNo.set(no, e); G4.ordem.push(no); }
    if (selada) e.depois++; else e.antes++;
  }

  function onMutacoes(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];

      // Auto-correção: se o feed nasce vazio, `achaLista` chuta errado no início.
      // Quem recebe mensagem em lote é a lista de verdade — adota e segue.
      if (m.type === 'childList' && m.addedNodes.length && m.target !== lista &&
          m.target.nodeType === 1 && container.contains(m.target) &&
          m.target.childElementCount > (lista ? lista.childElementCount : 0)) {
        lista = m.target;
      }

      if (m.type === 'childList' && m.target === lista && m.addedNodes.length) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var novo = m.addedNodes[j];
          if (novo.nodeType !== 1) continue;
          G4.ultima = novo;                 // a partir daqui, as anteriores estão seladas
          registra(novo, false);            // a montagem conta como 1, e é tolerada
        }
        continue;
      }

      var no = noDeMensagem(m.target);
      if (!no) continue;
      // O que interessa não é quantas vezes uma mensagem mudou — é quantas vezes
      // ela mudou DEPOIS de pronta. Enquanto é a última, ela está sendo escrita;
      // contar isso como repintura indevida reprovaria qualquer implementação.
      registra(no, no !== G4.ultima);
    }
  }

  /* --------------------------------------------------------------- resultado */

  function resumoG4() {
    var maxDepois = 0, somaDepois = 0, acimaDoCorte = 0, ultimaTotal = 0, n = 0;
    G4.porNo.forEach(function (e, no) {
      n++;
      if (no === G4.ultima) { ultimaTotal = e.antes + e.depois; return; }
      somaDepois += e.depois;
      if (e.depois > maxDepois) maxDepois = e.depois;
      if (e.depois > CORTES.g4_mutacoes_por_mensagem_selada) acimaDoCorte++;
    });
    return {
      mensagens_observadas: n,
      ultima_mensagem_total: ultimaTotal,
      seladas_max: maxDepois,
      seladas_soma: somaDepois,
      seladas_acima_do_corte: acimaDoCorte
    };
  }

  function resultado() {
    var fim = tFimSessao || agora();
    var g1p = p95(G1.deltas), g1m = maior(G1.deltas);
    var msG2 = G2.amostras.map(function (a) { return a.ms; });
    var corte20s = fim - 20000;
    var ult20 = G2.amostras
      .filter(function (a) { return a.t >= corte20s; })
      .map(function (a) { return a.ms; });
    var g2p = p95(msG2), g2p20 = p95(ult20);
    var g3 = G3.scrollPx + G3.ancoraPx;
    var g4 = resumoG4();

    return {
      meta: {
        gerado_em: new Date().toISOString(),
        url: location.href,
        origem: location.host,
        agente_usuario: navigator.userAgent,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        dpr: window.devicePixelRatio,
        duracao_s: t0Sessao ? r2((fim - t0Sessao) / 1000) : 0,
        concluida: !!tFimSessao,
        alvo: descreve(container),
        alvo_origem: origemAlvo,
        lista: descreve(lista),
        seletor_msg_casou: !!(CFG.seletorMsg && document.querySelector(CFG.seletorMsg)),
        probe: 'gate-probe.js'
      },
      cortes: CORTES,
      g1_cadencia_de_frame: {
        frames: G1.deltas.length,
        p95_ms: r2(g1p),
        pior_frame_ms: r2(g1m),
        mediana_ms: r2(percentil(G1.deltas, 0.5)),
        pausas_aba: G1.pausasAba,
        passou: g1p !== null && g1p <= CORTES.g1_p95_ms && g1m <= CORTES.g1_pior_frame_ms
      },
      g2_eco_da_digitacao: {
        // Zero amostra é NÃO MEDIDO, não reprovado. Ninguém digitou — reprovar
        // por isso transformaria "faltou operar" em "o app é lento".
        indisponivel: msG2.length === 0,
        motivo: msG2.length === 0 ? 'nenhuma tecla digitada durante a janela' : null,
        amostras: msG2.length,
        amostras_ultimos_20s: ult20.length,
        p95_ms: r2(g2p),
        p95_ultimos_20s_ms: r2(g2p20),
        pior_ms: r2(maior(msG2)),
        teclas_sem_pintura: G2.semPintura,
        passou: g2p === null ? null : g2p <= CORTES.g2_p95_ms
      },
      g3_scroll_nao_arrancado: {
        indisponivel: !container,
        motivo: container ? null : 'nenhum container de mensagens encontrado',
        total_px: container ? r2(g3) : null,
        por_scrolltop_px: container ? r2(G3.scrollPx) : null,
        por_deslocamento_de_ancora_px: container ? r2(G3.ancoraPx) : null,
        eventos: G3.eventos,
        passou: container ? g3 <= CORTES.g3_px : null
      },
      g4_repintura_cirurgica: {
        indisponivel: !container,
        motivo: container ? null : 'nenhum container de mensagens encontrado',
        mensagens_observadas: g4.mensagens_observadas,
        ultima_mensagem_mutacoes: g4.ultima_mensagem_total,
        seladas_max_por_mensagem: container ? g4.seladas_max : null,
        seladas_soma: container ? g4.seladas_soma : null,
        seladas_acima_do_corte: container ? g4.seladas_acima_do_corte : null,
        passou: container ? g4.seladas_max <= CORTES.g4_mutacoes_por_mensagem_selada : null
      }
    };
  }

  /* ------------------------------------------------------------- ciclo de vida */

  function iniciar() {
    if (rodando) return;
    if (!container) {
      var alvo = resolveContainer();
      container = alvo.el;
      origemAlvo = alvo.origem;
    }
    // Sem container, G1 e G2 continuam válidos — eles não dependem do feed. Só
    // G3 e G4 ficam indisponíveis, e o JSON diz isso em vez de fingir zero.
    // Recusar a medida inteira seria pior: no painel antigo a detecção pode
    // falhar e o operador ficaria sem nada, sem devtools para socorrer.
    if (!container) aviso('Sem feed: G1 e G2 medem, G3 e G4 ficam indisponíveis.');
    else { lista = achaLista(container); aviso(''); }

    zera();
    rodando = true;
    t0Sessao = agora();
    tFimSessao = 0;
    ultimoFrame = 0;
    pulaProximoDelta = false;
    if (container) {
      ultimoScrollTop = container.scrollTop;
      estavaRoladoPraCima = distanciaDoFim(container) > 8;
      obs = new MutationObserver(onMutacoes);
      obs.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
      container.addEventListener('scroll', onScroll, { passive: true });
    }

    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('visibilitychange', onVisibilidade);
    ['touchstart', 'touchmove', 'wheel', 'pointerdown'].forEach(function (ev) {
      window.addEventListener(ev, marcaGesto, { passive: true, capture: true });
    });

    rafId = requestAnimationFrame(laco);
    timerAncora = setInterval(mediAncora, 250);
    timerFim = setTimeout(parar, CFG.duracaoMs);
    pintaUI();
  }

  function parar() {
    if (!rodando) return;
    rodando = false;
    tFimSessao = agora();
    if (obs) { obs.disconnect(); obs = null; }
    if (container) container.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('visibilitychange', onVisibilidade);
    ['touchstart', 'touchmove', 'wheel', 'pointerdown'].forEach(function (ev) {
      window.removeEventListener(ev, marcaGesto, true);
    });
    cancelAnimationFrame(rafId);
    clearInterval(timerAncora);
    clearTimeout(timerFim);
    var r = resultado();
    campoJson.value = JSON.stringify(r, null, 2);
    pintaUI(r);
  }

  /* ------------------------------------------------------------------ overlay */

  var overlay, corpo, campoJson, btIniciar, btAlvo, linhaAviso, cabecalho;
  var minimizado = false;
  var escolhendoAlvo = false;

  function el(tag, css, texto) {
    var e = document.createElement(tag);
    if (css) e.setAttribute('style', css);
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  // Hex cru é deliberado: ver limite 5 no cabeçalho.
  var C = {
    fundo: '#15171b', borda: '#3a3f47', texto: '#eef0f3', fraco: '#a2a7ae',
    ok: '#68c98a', ruim: '#ff8080', acao: '#2b3038'
  };
  var MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

  function botao(rotulo, aoTocar) {
    var b = el('button',
      'flex:1;min-height:44px;padding:0 10px;border-radius:8px;border:1px solid ' + C.borda +
      ';background:' + C.acao + ';color:' + C.texto + ';font:600 14px ' + MONO +
      ';-webkit-appearance:none;touch-action:manipulation;', rotulo);
    b.addEventListener('click', aoTocar);
    return b;
  }

  function linha(id) {
    var l = el('div', 'display:flex;justify-content:space-between;gap:8px;padding:3px 0;');
    var a = el('span', 'color:' + C.fraco + ';flex:0 0 auto;', id);
    var b = el('span', 'color:' + C.texto + ';text-align:right;');
    l.appendChild(a); l.appendChild(b);
    l.valor = b;
    return l;
  }

  var linhas = {};

  function montaOverlay() {
    overlay = el('div',
      'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));' +
      'z-index:2147483647;background:' + C.fundo + ';color:' + C.texto +
      ';border:1px solid ' + C.borda + ';border-radius:12px;padding:10px;' +
      'font:14px/1.45 ' + MONO + ';-webkit-text-size-adjust:100%;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.5);max-height:70vh;overflow:auto;');

    cabecalho = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
    var titulo = el('strong', 'flex:1;font:700 14px ' + MONO + ';', 'gate-probe');
    var btMin = el('button',
      'min-width:44px;min-height:32px;border-radius:8px;border:1px solid ' + C.borda +
      ';background:transparent;color:' + C.fraco + ';font:700 16px ' + MONO + ';', '—');
    btMin.addEventListener('click', function () {
      minimizado = !minimizado;
      corpo.style.display = minimizado ? 'none' : 'block';
      btMin.textContent = minimizado ? '+' : '—';
    });
    cabecalho.appendChild(titulo);
    cabecalho.appendChild(btMin);

    corpo = el('div', '');

    linhas.estado = linha('estado');
    linhas.alvo = linha('alvo');
    linhas.g1 = linha('G1 p95 / pior');
    linhas.g2 = linha('G2 p95');
    linhas.g3 = linha('G3 desloc.');
    linhas.g4 = linha('G4 max selada');
    ['estado', 'alvo', 'g1', 'g2', 'g3', 'g4'].forEach(function (k) { corpo.appendChild(linhas[k]); });

    linhaAviso = el('div', 'color:' + C.ruim + ';font-size:13px;padding:4px 0;display:none;');
    corpo.appendChild(linhaAviso);

    var barra = el('div', 'display:flex;gap:6px;margin-top:8px;');
    btIniciar = botao('▶ Iniciar', function () { rodando ? parar() : iniciar(); });
    btAlvo = botao('Alvo', escolherAlvoPorToque);
    barra.appendChild(btIniciar);
    barra.appendChild(btAlvo);
    barra.appendChild(botao('Copiar', copiarJson));
    corpo.appendChild(barra);

    campoJson = el('textarea',
      'width:100%;height:120px;margin-top:8px;background:#0e1013;color:' + C.fraco +
      ';border:1px solid ' + C.borda + ';border-radius:8px;padding:6px;' +
      'font:12px ' + MONO + ';-webkit-text-size-adjust:100%;');
    campoJson.readOnly = true;
    campoJson.placeholder = 'JSON aparece aqui ao parar';
    corpo.appendChild(campoJson);

    overlay.appendChild(cabecalho);
    overlay.appendChild(corpo);
    document.body.appendChild(overlay);
  }

  function aviso(txt) {
    linhaAviso.textContent = txt || '';
    linhaAviso.style.display = txt ? 'block' : 'none';
  }

  function marca(v, passou) {
    return v + (passou === null ? '' : passou ? '  ✅' : '  ❌');
  }

  function pintaUI(r) {
    if (minimizado) return;
    var restante = rodando ? Math.max(0, (CFG.duracaoMs - (agora() - t0Sessao)) / 1000) : 0;
    linhas.estado.valor.textContent = rodando ? 'medindo · ' + restante.toFixed(0) + 's' : 'parado';
    linhas.alvo.valor.textContent = container ? (origemAlvo + ' · ' + descreve(container)) : '—';
    btIniciar.textContent = rodando ? '■ Parar' : '▶ Iniciar';

    if (!r) {
      var g1p = p95(G1.deltas), g1m = maior(G1.deltas);
      var g2p = p95(G2.amostras.map(function (a) { return a.ms; }));
      var g4 = resumoG4();
      linhas.g1.valor.textContent = g1p === null ? '—' : r2(g1p) + ' / ' + r2(g1m) + ' ms';
      linhas.g2.valor.textContent = g2p === null ? '—' : r2(g2p) + ' ms (' + G2.amostras.length + ')';
      linhas.g3.valor.textContent = r2(G3.scrollPx + G3.ancoraPx) + ' px';
      linhas.g4.valor.textContent = g4.seladas_max + ' (' + g4.mensagens_observadas + ' msg)';
      return;
    }

    linhas.g1.valor.textContent = marca(
      r.g1_cadencia_de_frame.p95_ms + ' / ' + r.g1_cadencia_de_frame.pior_frame_ms + ' ms',
      r.g1_cadencia_de_frame.passou);
    linhas.g2.valor.textContent = r.g2_eco_da_digitacao.indisponivel ? 'não digitou'
      : marca(r.g2_eco_da_digitacao.p95_ms + ' ms', r.g2_eco_da_digitacao.passou);
    linhas.g3.valor.textContent = r.g3_scroll_nao_arrancado.indisponivel ? 'indisponível'
      : marca(r.g3_scroll_nao_arrancado.total_px + ' px', r.g3_scroll_nao_arrancado.passou);
    linhas.g4.valor.textContent = r.g4_repintura_cirurgica.indisponivel ? 'indisponível'
      : marca(String(r.g4_repintura_cirurgica.seladas_max_por_mensagem),
              r.g4_repintura_cirurgica.passou);

    [linhas.g1, linhas.g2, linhas.g3, linhas.g4].forEach(function (l) {
      l.valor.style.color = l.valor.textContent.indexOf('❌') !== -1 ? C.ruim : C.ok;
    });
  }

  /* Escolher o alvo com o dedo — no painel antigo o scroller não tem marcador
     nenhum, e não existe devtools no iPhone. */
  function escolherAlvoPorToque() {
    if (escolhendoAlvo) return;
    escolhendoAlvo = true;
    aviso('Toque no feed de mensagens.');
    overlay.style.opacity = '0.35';

    var pegar = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      var alvo = document.elementFromPoint(pt.clientX, pt.clientY);
      while (alvo && !rolavel(alvo)) alvo = alvo.parentElement;
      window.removeEventListener('touchstart', pegar, true);
      window.removeEventListener('mousedown', pegar, true);
      escolhendoAlvo = false;
      overlay.style.opacity = '1';
      if (alvo) {
        container = alvo; lista = achaLista(alvo); origemAlvo = 'toque';
        aviso('');
      } else {
        aviso('Nada rolável embaixo do toque.');
      }
      pintaUI();
    };
    // passive:false explícito — no Safari touchstart em window é passivo por
    // default, e em listener passivo o preventDefault não faz nada.
    window.addEventListener('touchstart', pegar, { capture: true, passive: false });
    window.addEventListener('mousedown', pegar, true);
  }

  function copiarJson() {
    var txt = campoJson.value || JSON.stringify(resultado(), null, 2);
    campoJson.value = txt;
    var feito = function () { aviso(''); btIniciar.blur(); flash('copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(feito, manual);
    } else manual();

    function manual() {
      // Safari iOS antigo: só copia de campo selecionável e sob gesto do usuário.
      campoJson.readOnly = false;
      campoJson.focus();
      campoJson.setSelectionRange(0, txt.length);
      try { document.execCommand('copy'); flash('copiado'); }
      catch (e) { aviso('Copie à mão do campo abaixo.'); }
      campoJson.readOnly = true;
    }
  }

  function flash(txt) {
    var antes = cabecalho.firstChild.textContent;
    cabecalho.firstChild.textContent = 'gate-probe · ' + txt;
    setTimeout(function () { cabecalho.firstChild.textContent = antes; }, 1200);
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    montaOverlay();
    var alvo = resolveContainer();
    container = alvo.el; origemAlvo = alvo.origem;
    if (container) lista = achaLista(container);
    else aviso('Sem container. Toque em "Alvo".');
    // 500ms, não a cada frame: o instrumento não pode sujar o G1 que ele mede.
    timerUI = setInterval(function () { pintaUI(); }, 500);
    pintaUI();
    if (CFG.auto) iniciar();
  }

  window.__GATE_PROBE__ = {
    iniciar: iniciar,
    parar: parar,
    resultado: resultado,
    config: CFG,
    mostrar: function () { if (overlay) { overlay.style.display = 'block'; minimizado = false; corpo.style.display = 'block'; } },
    esconder: function () { if (overlay) overlay.style.display = 'none'; },
    destruir: function () {
      parar();
      clearInterval(timerUI);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      delete window.__GATE_PROBE__;
    }
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
