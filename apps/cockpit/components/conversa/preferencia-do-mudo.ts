export const CHAVE_MUDO = 'ck-conversa-mudo';

type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>;

export function criaPreferenciaDoMudo(armazenamento: () => Armazenamento) {
  const ouvintes = new Set<() => void>();
  let provisoria: boolean | undefined;

  const le = () => {
    if (provisoria !== undefined) return provisoria;
    try {
      return armazenamento().getItem(CHAVE_MUDO) === 'true';
    } catch {
      return true;
    }
  };
  const avisa = () => ouvintes.forEach((ouvinte) => ouvinte());
  const muda = (mudo: boolean) => {
    try {
      armazenamento().setItem(CHAVE_MUDO, String(mudo));
      provisoria = undefined;
    } catch {
      provisoria = mudo;
    }
    avisa();
  };
  const inscreve = (ouvinte: () => void) => {
    ouvintes.add(ouvinte);
    return () => { ouvintes.delete(ouvinte); };
  };

  return { le, muda, inscreve, avisa };
}
