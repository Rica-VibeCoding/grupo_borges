/**
 * O desenho das pastilhas do chrome do topo — a do agente e a de telas.
 *
 * AS DUAS SÃO IRMÃS, e isso é ordem do Rica (16/08): *"sempre que uma mudar a
 * outra vai mudar também"*. Por isso o desenho mora aqui e não em cada arquivo:
 * cor, raio, altura e respiro saem deste módulo, e mexer num valor daqui move as
 * duas no mesmo frame. Se um dia elas precisarem divergir, a divergência é
 * decisão consciente — passa por escrever a exceção, não por esquecer a irmã.
 *
 * O trilho é a casca escura; o miolo é a pastilha clara de dentro. A do agente
 * tem um miolo só (retrato + nome); a de telas tem um por tela, e só a ativa
 * pinta o miolo — inativa fica em texto sobre o trilho.
 *
 * ALTURA FIXA, e não padding vertical: o miolo do agente tem uma FOTO dentro e
 * o da tela tem texto. Com padding os dois nasciam de alturas diferentes (a foto
 * é mais alta que a linha de texto) e as irmãs desalinhavam por 2px — o
 * suficiente pra tirar o casamento que o Rica pediu.
 */

/** Altura do miolo, em px. O trilho soma 3px de cada lado. */
export const ALTURA_DO_MIOLO = 30;

/** O retrato dentro do miolo do agente. Menor que a altura de propósito: a foto
 *  tem que ficar DENTRO da bolha (*"mesmo que a foto tenha que diminuir um
 *  pouquinho"*), e encostada na borda ela lê como quadrado colado por fora. */
export const RETRATO_NA_PASTILHA = 22;

export const TRILHO_DA_PASTILHA = {
  padding: '3px',
  borderRadius: 'var(--ck-radius-pill)',
  background: 'var(--ck-surface-nav)',
} as const;

export const MIOLO_DA_PASTILHA = {
  height: ALTURA_DO_MIOLO,
  padding: '0 14px',
  borderRadius: 'var(--ck-radius-pill)',
  fontSize: 'var(--ck-text-sm)',
} as const;

/** Fundo do miolo aceso — o mesmo dos dois lados, que é o pedido. */
export const MIOLO_ACESO = 'var(--ck-surface-raised)';
