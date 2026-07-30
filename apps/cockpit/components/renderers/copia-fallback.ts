/**
 * O caminho de cópia que não depende do `navigator.clipboard`.
 *
 * Vive num módulo próprio porque agora tem dois consumidores — o bloco de código
 * do markdown e o bloco expandido da linha de execução. Duas cópias divergiriam
 * em silêncio, e a divergência aqui aparece como "copiar não faz nada" só no
 * Safari de alguém.
 *
 * Cada detalhe abaixo existe por causa do WebKit: `contentEditable` + `readOnly`
 * falso é o que faz o iOS aceitar a seleção programática, `fontSize: 16px` evita
 * o zoom automático ao focar, e o elemento fica na tela (fora da área visível,
 * não `display:none`) porque nó oculto não é selecionável.
 */
export function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.contentEditable = 'true';
  textarea.readOnly = false;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.fontSize = '16px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
