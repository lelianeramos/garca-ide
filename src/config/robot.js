/**
 * CONFIGURAÇÃO DO ROBÔ — GARÇA DE BOTAS
 * ======================================
 *
 * ESTE ARQUIVO É A FONTE ÚNICA da geometria do robô. Antes these números
 * estavam espalhados (56 mm no catálogo, 112 mm no bloco, 112 mm no
 * conversor Python->bloco...). Um valor duplicado divergia do outro e o
 * time perdia tempo caçando por que o robô andava torto.
 *
 * Padrão da equipe Garça de Botas:
 *   • diâmetro da roda: 62,4 mm
 *   • distância entre os centros das rodas (axle track): 48 mm
 *
 * Tudo que depende disso — DriveBase, blocos de movimento, conversão
 * Python -> bloco, geração de código e o painel do robô — lê daqui.
 */

export const ROBOT_CONFIG = Object.freeze({
  /** Diâmetro da roda em milímetros. */
  wheel_diameter: 62.4,
  /** Distância entre os centros das rodas (axle track) em milímetros. */
  axle_track: 48,
  /** Portas padrão dos dois motores de tração. */
  left_port: "A",
  right_port: "B",
  /** HUB usado pela equipe. */
  hub: "PrimeHub",
  /** Diâmetro da roda do HUB (mesma roda, usado por utilitários). */
  name: "Robô da equipe Garça de Botas",
});

/** Cópia mutável — usada quando o usuário ajusta no painel do robô. */
export function robotConfig() {
  return { ...ROBOT_CONFIG };
}

/** Milímetros por rotação da roda, derivado do diâmetro. */
export function mmPerRotation(wheelDiameter = ROBOT_CONFIG.wheel_diameter) {
  return Math.PI * Number(wheelDiameter);
}

/** Diâmetro correspondente a "1 rotação de movimento = X cm". */
export function wheelDiameterForCm(cm) {
  return (Number(cm) * 10) / Math.PI;
}

/** Centímetros correspondentes a uma rotação da roda. */
export function cmPerRotation(wheelDiameter = ROBOT_CONFIG.wheel_diameter) {
  return (mmPerRotation(wheelDiameter) / 10);
}

/** Linhas de Python que inicializam o robô com a configuração padrão. */
export function configPythonSnippet() {
  return [
    "# Configuração do robô (fonte única: src/config/robot.js)",
    `ROBOT_WHEEL_DIAMETER = ${ROBOT_CONFIG.wheel_diameter}`,
    `ROBOT_AXLE_TRACK = ${ROBOT_CONFIG.axle_track}`,
  ].join("\n");
}

export default ROBOT_CONFIG;
