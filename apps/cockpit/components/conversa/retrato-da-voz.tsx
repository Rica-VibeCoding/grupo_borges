'use client';

import { PilulaDoAgente as Pilula } from '../shell/pilula-do-agente';

import { rotuloDoEstado } from './direcao-da-voz';
import { tomDaCena, type Cena } from './moldura-estado';

/**
 * A pílula na tela de voz: a peça única (`shell/pilula-do-agente`) no alto, logo abaixo da ilha do
 * iPhone, com a cena da conversa — falando, o aro respira e solta ondas; ouvindo, as barras andam.
 */
export function PilulaDoAgente({ slug, nome, cena, segundos }: { slug: string; nome: string; cena: Cena; segundos?: number }) {
  return <Pilula slug={slug} nome={nome} tom={tomDaCena(cena)} rotulo={rotuloDoEstado(cena)} cena={cena} segundos={segundos} />;
}
