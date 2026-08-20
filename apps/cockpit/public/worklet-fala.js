/**
 * Coletor de fala — roda na thread de áudio, junta as amostras cruas e entrega
 * ao hook em blocos.
 *
 * De propósito burro: não converte, não reamostra, não decide nada. A conta de
 * 24 kHz mora em `components/shell/fala-ao-vivo.ts`, que é testado. Aqui não dá
 * pra testar nada — este arquivo é servido cru de `public/`, fora do build.
 *
 * Junta antes de mandar porque `process` é chamado a cada 128 amostras: a 48
 * kHz isso daria 375 mensagens por segundo atravessando pra thread que desenha
 * a onda a 60fps. Em blocos de 2048 são ~23 por segundo.
 */
class ColetorDeFala extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    const config = (opcoes && opcoes.processorOptions) || {};
    this.porBloco = config.porBloco || 2048;
    this.buffer = new Float32Array(this.porBloco);
    this.usado = 0;
  }

  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    // Sem canal é um instante sem dado (troca de dispositivo, silêncio do
    // driver), não fim de vida: devolver `false` aqui encerraria o processador
    // e a gravação ficaria muda pro resto do gesto.
    if (!canal) return true;

    for (let i = 0; i < canal.length; i++) {
      this.buffer[this.usado++] = canal[i];
      if (this.usado === this.porBloco) {
        const cheio = this.buffer;
        // Transfere em vez de copiar — o buffer é destacado aqui e renasce
        // na linha seguinte.
        this.port.postMessage(cheio, [cheio.buffer]);
        this.buffer = new Float32Array(this.porBloco);
        this.usado = 0;
      }
    }
    return true;
  }
}

registerProcessor('coletor-de-fala', ColetorDeFala);
