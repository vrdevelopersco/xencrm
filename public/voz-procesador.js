/* El micrófono de la llamada de voz (voz.js). Corre en el hilo de audio: aquí no hay página ni red.
   Cada ~100 ms entrega el audio en PCM16 a 24 kHz, que es lo que pide Grok. Si el navegador no dejó abrir el
   contexto a 24 kHz, se remuestrea aquí (interpolación lineal: para voz basta). */
class Microfono extends AudioWorkletProcessor {
  constructor(opciones) {
    super();
    var o = (opciones && opciones.processorOptions) || {};
    this.paso = (o.desde || sampleRate) / 24000; // muestras de entrada por cada muestra de salida
    this.pos = 0;
    this.anterior = 0;
    this.trozo = new Int16Array(2400); // 100 ms a 24 kHz
    this.n = 0;
  }
  process(entradas) {
    var canal = entradas[0] && entradas[0][0];
    if (!canal) return true;
    // Se camina por la entrada en pasos de `paso`; entre dos muestras, la recta que las une.
    while (this.pos < canal.length) {
      var i = Math.floor(this.pos), f = this.pos - i;
      var a = i === 0 ? this.anterior : canal[i - 1], b = canal[i];
      var s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.trozo[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.trozo.length) {
        this.port.postMessage(this.trozo.buffer, [this.trozo.buffer]);
        this.trozo = new Int16Array(2400);
        this.n = 0;
      }
      this.pos += this.paso;
    }
    this.pos -= canal.length;
    this.anterior = canal[canal.length - 1];
    return true;
  }
}
registerProcessor('xencrm-microfono', Microfono);
