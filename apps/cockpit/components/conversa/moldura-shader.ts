/**
 * Fragment shader da Moldura. Unidades em px CSS; y cresce para cima.
 *
 * - A moldura cola no vidro nos quatro lados, com o canto do iPhone (`uRaio`); o
 *   indicador de início do sistema passa por cima da luz, como nos apps nativos.
 * - A luz abraça a borda: some antes de ~60 px (Fio) ou ~110 px (Aurora).
 * - Contraste por construção: dentro da zona de texto (`uZonaTopo`..`uZonaBase`,
 *   a 22 px ou mais da borda, com rampa de 48 px fora do texto) a luminância final não passa de 0,05 — texto
 *   secundário fica acima de 4,5:1 e o primário acima de 7:1 (estética §3).
 * - `uAurora` 0 = Fio (linha nítida e brilho curto); 1 = Aurora (sem linha,
 *   névoa larga em cortinas).
 */
export const FRAG_MOLDURA = `
precision highp float;
uniform vec2 uRes;
uniform float uEsc, uRaio, uZonaTopo, uZonaBase;
uniform float uT, uNivel, uProg, uJanela, uOrbita, uCauda, uPulso, uAurora;
uniform vec4 uA, uB;
uniform vec3 uFundo, uVoce, uZe, uPensa, uPrepara, uErro, uOcupado, uCorPulso;

float sdRR(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float desce(float alto, float baixo, float x) { return 1. - smoothstep(baixo, alto, x); }
float tremor(float a, float t) { return .5 + .25 * sin(a * 3. + t * 1.3) + .15 * sin(a * 7. - t * 2.1) + .1 * sin(a * 13. + t * 3.7); }
float cortina(float a, float t) { return .5 + .5 * sin(a * 9. + t * .8 + 2.2 * sin(a * 3. - t * .5)); }
vec3 paraLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(vec3(.04045), c)); }
vec3 paraSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }

void main() {
  vec2 tam = uRes / uEsc;
  vec2 css = gl_FragCoord.xy / uEsc;
  vec2 b = .5 * tam;
  vec2 p = css - b;
  float sd = sdRR(p, b, uRaio);
  float d = abs(sd);
  float ang = atan(p.x, p.y);
  float ny = p.y / b.y;
  float au = uAurora;
  float fio = exp(-d / 1.6) * (1. - au * .85);
  float perto = exp(-d / mix(10., 16., au));
  float medio = exp(-d / mix(22., 40., au));
  float cort = mix(1., .35 + .9 * cortina(ang, uT), au);
  float largura = mix(14., 36., uNivel) * mix(1., 1.8, au);
  /* alcance duro: nenhum brilho passa daqui, senão a modulação por ângulo vira raios até o centro */
  float alcance = 1. - smoothstep(mix(40., 60., au), mix(90., 120., au), d);
  vec3 c = vec3(0.);

  /* sua vez: maré que sobe do pé */
  float alc = mix(-.62, .28, uNivel) + .25 * au + .16 * uNivel * (tremor(ang * 1.7, uT * 1.6) - .5);
  float mv = desce(alc + .35, alc - .25, ny);
  c += uVoce * uA.x * mv * (exp(-d / largura) * alcance * (.3 + .9 * uNivel) * (.7 + .6 * tremor(ang, uT)) * cort + perto * .45 + fio * .9);

  /* vez dele: luz que desce do topo */
  float alz = mix(.62, -.28, uNivel) - .25 * au;
  float mz = smoothstep(alz - .35, alz + .25, ny);
  float faixas = .55 + .45 * sin(ny * 10. + uT * 2.8);
  c += uZe * uA.y * mz * (exp(-d / largura) * alcance * (.3 + .9 * uNivel) * mix(faixas, cort, au) + perto * .45 + fio * .9);

  /* pensando: cometa que orbita; a cauda cresce com a espera */
  float delta = mod(uOrbita - ang + 12.566, 6.2832);
  float cometa = max(exp(-delta / uCauda), exp(-(6.2832 - delta) / .05));
  float delta2 = mod(uOrbita + 3.1416 - ang + 12.566, 6.2832);
  cometa += .45 * max(exp(-delta2 / (uCauda * .5)), exp(-(6.2832 - delta2) / .05));
  c += uPensa * uA.z * (fio * (.22 + 1.2 * cometa) + perto * cometa * .9 + medio * alcance * cometa * .8);

  /* preparando: um traço corre a moldura enquanto o detector baixa */
  float f = mod(ang + 6.2832, 6.2832) / 6.2832;
  float atras = mod(uProg - f + 1., 1.);
  float feito = desce(uJanela, uJanela - .02, atras);
  float ponta = exp(-min(atras, 1. - atras) * 60.) * (1. - step(.999, uJanela));
  c += uPrepara * uA.w * (fio * (.1 + .9 * feito) + perto * .35 * feito + (perto + medio) * ponta * 1.1);

  /* erro: moldura parada, com a falha no pé (onde fica o microfone) */
  c += uErro * uB.x * smoothstep(.10, .20, 3.1416 - abs(ang)) * (fio + perto * .5 + medio * .3);
  /* agente ocupado: o mesmo desenho parado do erro, na cor própria */
  c += uOcupado * uB.w * smoothstep(.10, .20, 3.1416 - abs(ang)) * (fio + perto * .5 + medio * .3);
  /* interrompendo: a voz dele congela no topo, apagada */
  c += uZe * uB.y * smoothstep(-.1, .5, ny) * (fio * .8 + perto * .3 + medio * .2) * .55;
  /* parado: só o fio */
  c += uPrepara * uB.z * (fio * .25 + perto * .06);
  /* troca de vez: a moldura inteira acende uma vez */
  c += uCorPulso * uPulso * (fio * .9 + perto * .6 + medio * .5);

  c *= mix(1., .75, step(0., sd));
  c = 1. - exp(-c * 1.15);
  vec3 cor = uFundo + c * (1. - uFundo);

  float yTopo = tam.y - css.y;
  float zona = smoothstep(uZonaTopo, uZonaTopo + 48., yTopo) * desce(uZonaBase, uZonaBase - 48., yTopo) * smoothstep(12., 22., -sd);
  /* compressor suave: a luz acima do fundo tende a (0,05 - fundo) sem nunca passar */
  vec3 W = vec3(.2126, .7152, .0722);
  vec3 linF = paraLinear(uFundo);
  vec3 lin = paraLinear(cor);
  float folga = .05 - dot(linF, W);
  float luz = max(dot(lin, W) - dot(linF, W), 1e-5);
  vec3 limitada = paraSrgb(linF + (lin - linF) * (folga * (1. - exp(-luz / folga)) / luz));
  gl_FragColor = vec4(mix(cor, limitada, zona), 1.);
}`;
