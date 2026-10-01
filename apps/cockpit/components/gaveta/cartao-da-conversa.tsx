'use client';

/**
 * Os ajustes da tela de voz, como cartão da gaveta. Só aparecem quando a
 * gaveta abre pela conversa (`mostraConversaNoPainel`): a gaveta é a única
 * casa deles. Fone e texto são interruptores; moldura, esfera e o par
 * esfera/moldura são pílulas segmentadas. O visual é UMA escolha só — marcar
 * uma variação desmarca as dos outros grupos, como sempre foi.
 */
import { useDetalheDaConversa } from '../conversa/contexto-configuracao-conversa';
import { CATALOGO } from '../conversa/preferencia-visual';
import { CHAVE_FONE, CHAVE_TEXTO } from '../conversa/preferencias-da-conversa';
import { useChaveDaConversa, useVisualConversa } from '../conversa/use-preferencias-conversa';
import { Cartao, Interruptor, Segmentado } from './pecas';

function LinhaDeChave({ nome, ligada, muda }: { nome: string; ligada: boolean; muda: (ligada: boolean) => void }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)' }}>
      <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>{nome}</span>
      <Interruptor ligado={ligada} rotulo="" descricao={nome} aoAlternar={() => muda(!ligada)} />
    </div>
  );
}

export function CartaoDaConversa() {
  const [visual, escolheVisual] = useVisualConversa();
  const [fone, mudaFone] = useChaveDaConversa(CHAVE_FONE);
  const [texto, mudaTexto] = useChaveDaConversa(CHAVE_TEXTO);
  const detalheTecnico = useDetalheDaConversa();

  return (
    <Cartao titulo="Conversa">
      <div className="flex flex-col">
        <LinhaDeChave nome="Estou de fone" ligada={fone} muda={mudaFone} />
        <LinhaDeChave nome="Mostrar texto" ligada={texto} muda={mudaTexto} />
      </div>
      {CATALOGO.map((item) => (
        <Segmentado
          key={item.opcao}
          nome={item.nome}
          itens={item.variacoes}
          marcado={(id) => visual.opcao === item.opcao && visual.variacao === id}
          escolhe={(id) => escolheVisual({ opcao: item.opcao, variacao: id })}
        />
      ))}
      {detalheTecnico ? (
        <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>{detalheTecnico}</p>
      ) : null}
    </Cartao>
  );
}
