const SERVICE = "c5f50001-8280-46da-89f4-6d8051e4aeef";
const COMMAND_EVENT = "c5f50002-8280-46da-89f4-6d8051e4aeef";

export class PybricksHub extends EventTarget {
  constructor() { super(); this.state = "DISCONNECTED"; }
  setState(state, detail = {}) { this.state = state; this.dispatchEvent(new CustomEvent("state", { detail: { state, ...detail } })); }
  async connect() {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth requer Chrome ou Edge em HTTPS/localhost");
    this.setState("SEARCHING");
    try {
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
      this.setState("FOUND", { name: this.device.name });
      this.device.addEventListener("gattserverdisconnected", () => this.setState("DISCONNECTED"));
      this.setState("CONNECTING");
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.characteristic = await service.getCharacteristic(COMMAND_EVENT);
      await this.characteristic.startNotifications();
      this.characteristic.addEventListener("characteristicvaluechanged", event => this.onData(event.target.value));
      this.setState("READY", { name: this.device.name || "SPIKE Prime" });
    } catch (error) { this.setState("FAILED", { error: error.message }); throw error; }
  }
  onData(value) {
    const bytes = new Uint8Array(value.buffer);
    const text = new TextDecoder().decode(bytes.slice(1));
    if (text) this.dispatchEvent(new CustomEvent("output", { detail: text }));
  }
  async run(code) {
    if (this.state !== "READY") throw new Error("Conecte o HUB antes de executar");
    if (!window.pybricksCompile) throw new Error("Compilador Pybricks indisponível");
    this.setState("UPLOADING");
    const result = await window.pybricksCompile("main.py", code);
    if (result.status !== 0 || !result.mpy) throw new Error(result.err?.join("\n") || "Falha ao compilar");
    const bytes = new Uint8Array(result.mpy);
    for (let offset = 0; offset < bytes.length; offset += 100) {
      await this.characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + 100));
    }
    this.setState("RUNNING");
  }
  async stop() {
    if (!this.characteristic) return;
    await this.characteristic.writeValueWithoutResponse(Uint8Array.of(0));
    this.setState("READY");
  }
}
