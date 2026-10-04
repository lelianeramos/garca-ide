/**
 * SOM E MICROINTERAÇÕES — GARÇA DE BOTAS CODE STUDIO
 * --------------------------------------------------
 * Parte 23: sintetizado com Web Audio (sem arquivos externos — o preview e o
 * deploy não dependem de rede). Curto (<180 ms), discreto, volume baixo.
 * Nunca encadeia sons em sequência rápida (sem "metralhadora").
 */

const MIN_GAP_MS = 70;

class SoundEngine {
  constructor() {
    this.enabled = true;
    this.volume = 0.24;      // volume baixo por padrão (Parte 23.2)
    this.context = null;
    this.lastPlayed = new Map();
  }

  /** O AudioContext só pode ser criado após um gesto do usuário. */
  ensureContext() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume().catch(() => {});
      return this.context;
    }
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  setEnabled(value) { this.enabled = Boolean(value); }
  setVolume(percent) { this.volume = Math.max(0, Math.min(100, Number(percent) || 0)) / 100; }

  /**
   * Toca um evento sonoro.
   * @param {string} event nome do evento (Parte 23.1)
   */
  play(event) {
    if (!this.enabled || this.volume <= 0) return;

    // Sem metralhadora: mesmo evento precisa de um intervalo mínimo
    const now = Date.now();
    const last = this.lastPlayed.get(event) ?? 0;
    if (now - last < MIN_GAP_MS) return;
    this.lastPlayed.set(event, now);

    const context = this.ensureContext();
    if (!context) return;

    const recipe = RECIPES[event];
    if (!recipe) return;

    const started = context.currentTime;
    const gain = context.createGain();
    gain.connect(context.destination);

    recipe.notes.forEach((note, index) => {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = note.wave ?? "sine";
      oscillator.frequency.setValueAtTime(note.frequency, started + (note.at ?? 0));

      const peak = this.volume * (note.gain ?? 0.5);
      const duration = note.duration ?? 0.09;
      const offset = started + (note.at ?? 0);

      noteGain.gain.setValueAtTime(0.0001, offset);
      noteGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), offset + 0.012);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, offset + duration);

      oscillator.connect(noteGain);
      noteGain.connect(gain);
      oscillator.start(offset);
      oscillator.stop(offset + duration + 0.02);
      if (index === 0) gain.gain.setValueAtTime(1, started);
    });
  }
}

/** Receitas: todas < 180 ms (Parte 23.2). */
const RECIPES = {
  // Encaixe de bloco — 90 ms
  snap: { notes: [{ frequency: 620, duration: 0.055, wave: "triangle", gain: 0.42 }, { frequency: 880, duration: 0.05, wave: "triangle", gain: 0.3, at: 0.035 }] },
  // Exclusão de bloco
  remove: { notes: [{ frequency: 320, duration: 0.08, wave: "sine", gain: 0.34 }, { frequency: 210, duration: 0.07, wave: "sine", gain: 0.24, at: 0.05 }] },
  // HUB conectado
  hubConnected: { notes: [{ frequency: 523, duration: 0.09, wave: "sine", gain: 0.4 }, { frequency: 784, duration: 0.11, wave: "sine", gain: 0.36, at: 0.07 }] },
  // HUB desconectado
  hubDisconnected: { notes: [{ frequency: 392, duration: 0.09, wave: "sine", gain: 0.34 }, { frequency: 262, duration: 0.1, wave: "sine", gain: 0.3, at: 0.07 }] },
  // Execução iniciada
  runStart: { notes: [{ frequency: 660, duration: 0.07, wave: "square", gain: 0.22 }, { frequency: 990, duration: 0.09, wave: "square", gain: 0.18, at: 0.06 }] },
  // Execução finalizada
  runEnd: { notes: [{ frequency: 880, duration: 0.07, wave: "sine", gain: 0.3 }, { frequency: 1175, duration: 0.1, wave: "sine", gain: 0.26, at: 0.06 }] },
  // Execução interrompida
  runStop: { notes: [{ frequency: 300, duration: 0.13, wave: "sawtooth", gain: 0.2 }] },
  // Código atualizado no GitHub
  commit: { notes: [{ frequency: 700, duration: 0.06, wave: "sine", gain: 0.3 }, { frequency: 940, duration: 0.06, wave: "sine", gain: 0.28, at: 0.055 }, { frequency: 1180, duration: 0.09, wave: "sine", gain: 0.24, at: 0.11 }] },
  // Erro
  error: { notes: [{ frequency: 190, duration: 0.15, wave: "square", gain: 0.2 }] },
  // Aviso
  warning: { notes: [{ frequency: 440, duration: 0.1, wave: "triangle", gain: 0.24 }] },
  // Clique de interface
  click: { notes: [{ frequency: 500, duration: 0.03, wave: "sine", gain: 0.16 }] },
};

export const sound = new SoundEngine();
export default sound;
