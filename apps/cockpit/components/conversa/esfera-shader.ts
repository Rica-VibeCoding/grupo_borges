/**
 * Fragment shader da Esfera: raymarching de uma esfera viva, sobre fundo
 * transparente (a Moldura, quando existe, aparece por trás). Unidades em px CSS;
 * y cresce para cima. Saída em alfa pré-multiplicado.
 *
 * - `uVidro` 0 = Matéria (corpo sólido com luz de frente, manchas e veios);
 *   1 = Vidro (casca escura, borda acesa e a luz morando dentro).
 * - A luz fica no palco (`uFaixaBaixo`..`uFaixaAlto`): some nos últimos 48 px,
 *   então nunca passa por trás das palavras. O halo é radial e contínuo (não
 *   depende da marcha), senão a esfera-limite aparece como um disco.
 * - Formas: `uVoce` puxa para baixo (para você), `uZe` solta ondas, `uCalma`
 *   recolhe e acende veios (ou luas, no Vidro), `uCristal` vira gema,
 *   `uColapso` encolhe e racha, `uEnche` enche e esvazia de luz, `uApaga` murcha e
 *   desliga a luz de dentro e o halo — sobra a casca, com o brilho do vidro.
 * - `uCorte` (px, só na miniatura; 0 = desligado): a luz morre num círculo antes
 *   da borda da caixa. Sem ele, halo e aresta chegavam à borda com alfa ~0,19 e
 *   o corte reto do canvas desenhava um quadrado em volta da esfera.
 */
export const FRAG_ESFERA = `
precision highp float;
uniform vec2 uCentro;
uniform float uEsc, uRaio, uFaixaBaixo, uFaixaAlto, uCorte;
uniform float uT, uNivel, uVidro, uProg, uPulso;
uniform float uVoce, uZe, uCalma, uCristal, uColapso, uEnche, uApaga;
uniform vec3 uCorpo, uBorda, uCorPulso, uFundo;

float desce(float alto, float baixo, float x) { return 1. - smoothstep(baixo, alto, x); }

/* ruído simplex 3D, Ashima Arts (licença MIT) */
vec3 mod289(vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 mod289(vec4 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 permute(vec4 x) { return mod289(((x * 34.) + 1.) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - .85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1. / 6., 1. / 3.); const vec4 D = vec4(0., .5, 1., 2.);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1. - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0., i1.z, i2.z, 1.)) + i.y + vec4(0., i1.y, i2.y, 1.)) + i.x + vec4(0., i1.x, i2.x, 1.));
  vec3 ns = .142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49. * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7. * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1. - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2. + 1.; vec4 s1 = floor(b1) * 2. + 1.; vec4 sh = -step(h, vec4(0.));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.); m = m * m;
  return 42. * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/* gema de 16 faces (icosaedro + dodecaedro): a voz dele congelada na interrupção */
const float PHI = 1.618034;
float gema(vec3 p) {
  p = vec3(p.x * .94 + p.z * .34, p.y, -p.x * .34 + p.z * .94);
  float d = abs(dot(p, normalize(vec3(1., 1., 1.))));
  d = max(d, abs(dot(p, normalize(vec3(-1., 1., 1.))))); d = max(d, abs(dot(p, normalize(vec3(1., -1., 1.)))));
  d = max(d, abs(dot(p, normalize(vec3(1., 1., -1.))))); d = max(d, abs(dot(p, normalize(vec3(0., 1., PHI + 1.)))));
  d = max(d, abs(dot(p, normalize(vec3(0., -1., PHI + 1.))))); d = max(d, abs(dot(p, normalize(vec3(PHI + 1., 0., 1.)))));
  d = max(d, abs(dot(p, normalize(vec3(-PHI - 1., 0., 1.))))); d = max(d, abs(dot(p, normalize(vec3(1., PHI + 1., 0.)))));
  d = max(d, abs(dot(p, normalize(vec3(-1., PHI + 1., 0.))))); d = max(d, abs(dot(p, normalize(vec3(0., PHI, 1.)))));
  d = max(d, abs(dot(p, normalize(vec3(0., -PHI, 1.))))); d = max(d, abs(dot(p, normalize(vec3(1., 0., PHI)))));
  d = max(d, abs(dot(p, normalize(vec3(-1., 0., PHI))))); d = max(d, abs(dot(p, normalize(vec3(PHI, 1., 0.)))));
  d = max(d, abs(dot(p, normalize(vec3(-PHI, 1., 0.)))));
  return d - .9;
}

/* raio da forma sem as ondulações: é dele que o halo se afasta */
float raioBase() { return (1. + .07 * uNivel * (uVoce + uZe)) * (1. - .3 * uColapso) * (1. - .08 * uCalma) * (1. - .1 * uApaga); }

float mapa(vec3 p) {
  float liso = mix(1., .45, uVidro);
  float amp = mix(.02, .11, uNivel) * liso * (1. - uCalma * .6) * (1. - uColapso) * (1. - uCristal) * (1. - uApaga);
  float d = (snoise(p * 1.15 + vec3(0., 0., uT * .35)) + .25 * snoise(p * 2.6 - vec3(uT * .5, 0., 0.))) * amp;
  d += uVoce * uNivel * .16 * liso * desce(.2, -1., p.y) * (.7 + .3 * snoise(p * 1.6 + uT));
  d += uZe * (.018 + .055 * uNivel) * liso * sin(length(p.xy) * 7. - uT * 7.);
  return mix(length(p) - raioBase() - d, gema(p), uCristal);
}

vec3 normal(vec3 p) {
  const vec2 e = vec2(.004, -.004);
  return normalize(e.xyy * mapa(p + e.xyy) + e.yyx * mapa(p + e.yyx) + e.yxy * mapa(p + e.yxy) + e.xxx * mapa(p + e.xxx));
}

/* distância entre o raio e um ponto: a luz de dentro do Vidro */
float perto(vec3 c, vec3 ro, vec3 rd) { vec3 oc = c - ro; return length(oc - rd * dot(oc, rd)); }

void main() {
  vec2 css = gl_FragCoord.xy / uEsc;
  float faixa = smoothstep(uFaixaBaixo, uFaixaBaixo + 48., css.y) * desce(uFaixaAlto, uFaixaAlto - 48., css.y);
  vec2 uv = (css - uCentro) / uRaio;
  if (uCorte > 0.) faixa *= desce(uCorte, uCorte * .8, length(css - uCentro));
  if (faixa <= 0. || dot(uv, uv) > 9.) { gl_FragColor = vec4(0.); return; }

  vec3 ro = vec3(0., 0., 3.4), rd = normalize(vec3(uv / 3.25, -1.));
  float t = 0., minD = 9.; bool acertou = false;
  float b = dot(ro, rd), disc = b * b - dot(ro, ro) + 1.7 * 1.7;   /* esfera-limite: fora dela, nada a marchar */
  if (disc > 0.) {
    t = max(0., -b - sqrt(disc));
    for (int i = 0; i < 64; i++) {
      float d = mapa(ro + rd * t); minD = min(minD, d);
      if (d < .002) { acertou = true; break; }
      t += d * .6; if (t > 6.) break;
    }
  } else { minD = length(cross(ro, rd)) - 1.; }

  if (!acertou) {
    float fora = max(length(cross(ro, rd)) - mix(raioBase(), .95, uCristal), 0.);
    float halo = exp(-fora * mix(5., 8., uColapso)) * (.24 + .42 * uNivel * (uVoce + uZe)) * (1. - uColapso * .6) * mix(1., .75, uVidro) * (1. - .92 * uApaga);
    float aresta = exp(-max(minD, 0.) * uRaio * uEsc * .8);          /* ~1 px de borda macia */
    vec3 cor = uBorda * (halo + aresta * .7) + uCorPulso * uPulso * halo * 1.6;
    float a = clamp(halo + aresta * .7 + uPulso * halo * 1.6, 0., 1.);
    gl_FragColor = vec4(min(cor, vec3(a)), a) * faixa;
    return;
  }

  vec3 p = ro + rd * t; vec3 n = normal(p);
  vec3 luz = normalize(vec3(-.55, .75, .6));
  float frente = max(dot(n, -rd), 0.);
  float fres = pow(1. - frente, 2.3);
  float dif = max(dot(n, luz), 0.);
  float spec = pow(max(dot(reflect(rd, n), luz), 0.), mix(28., 90., max(uCristal, uVidro)));
  float nivelAgua = mix(-1.05, 1.05, uProg) + .035 * sin(p.x * 9. + uT * 2.5);
  float abaixo = desce(nivelAgua + .03, nivelAgua - .03, p.y);
  float plano = abs(dot(normalize(p), normalize(vec3(.8, .35, .5))) + .08 * snoise(p * 4.));
  float racha = 1. - (1. - smoothstep(0., .045, plano)) * .9 * uColapso;

  /* Matéria: corpo sólido, luz de frente, manchas; veios de luz quando pensa */
  float veio = pow(1. - abs(snoise(p * 2.4 + vec3(0., uT * .55, uT * .2))), 9.);
  float mancha = .5 + .5 * snoise(p * 1.7 - vec3(0., uT * .3, 0.));
  vec3 materia = uCorpo * (.1 + .3 * dif + .14 * mancha * (1. - uCristal) + .22 * pow(frente, 1.6) + 1.5 * veio * uCalma);
  materia *= mix(1., abaixo * 1.3 + .08, uEnche);

  /* Vidro: a luz mora dentro — desce para você, pulsa em anéis quando ele fala, vira duas luas quando pensa */
  vec3 centro = vec3(0., -.32 * uVoce * (.4 + .6 * uNivel), 0.);
  float tam = mix(.2, .36, uNivel * max(uVoce, uZe)) * (1. - .5 * uCristal) * (1. - .45 * uCalma);
  float dn = perto(centro, ro, rd);
  float nucleo = exp(-dn * dn / (tam * tam)) * (.9 + 1.1 * uNivel * (uVoce + uZe)) * (1. - uColapso) * (1. - uApaga);
  float aneis = uZe * pow(.5 + .5 * sin(dn * 16. - uT * 6.), 5.) * exp(-dn * 2.2) * (.35 + .65 * uNivel);
  float luas = 0.;
  for (int k = 0; k < 2; k++) {
    float a = uT * 1.6 + float(k) * 3.1416;
    float dl = perto(vec3(.5 * cos(a), .18 * sin(a * .7), .5 * sin(a)), ro, rd);
    luas += exp(-dl * dl / .012);
  }
  float fissura = (1. - smoothstep(0., .03, plano)) * uColapso;
  vec3 vidro = uFundo * .45 + uCorpo * (nucleo + aneis * .8 + luas * .9 * uCalma + uEnche * abaixo * (.25 + .5 * frente) + .05 * frente)
    + uBorda * fissura * .8;

  vec3 cor = mix(materia, vidro, uVidro) * mix(racha, 1., uVidro)
    + uBorda * fres * mix(1.25, 1.7, uVidro) * (1. + .5 * uNivel * uVoce) * (1. - .55 * uApaga)
    + vec3(spec) * mix(.45, .9, max(uCristal, uVidro * .8)) * (1. - uColapso * .7) * (1. - .5 * uApaga)
    + uCorPulso * uPulso * (.35 + 1.2 * fres);
  gl_FragColor = vec4(1. - exp(-cor * 1.25), 1.) * faixa;
}`;
