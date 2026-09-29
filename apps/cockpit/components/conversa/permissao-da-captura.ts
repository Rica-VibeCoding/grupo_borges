export function criaPermissaoDaCaptura() {
  const bloqueadoRef = { current: true };
  let geracao = 0;
  return {
    bloqueadoRef,
    muda(mudo: boolean) {
      if (mudo !== bloqueadoRef.current) geracao++;
      bloqueadoRef.current = mudo;
    },
    vigente() {
      const minha = geracao;
      return () => !bloqueadoRef.current && geracao === minha;
    },
  };
}
