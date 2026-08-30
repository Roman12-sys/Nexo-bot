// QUÉ CAMBIÓ: archivo nuevo. Bus de eventos interno — mismo patrón de registro que ya
// usa el proyecto en src/components/buttons.js (registerPrefix + array de handlers),
// aplicado a eventos de dominio en vez de customIds de botones. Un solo EventEmitter en
// memoria, sin cola externa: el bot corre en un único proceso (mismo criterio que
// asyncLock.js), no hace falta más que esto.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 7) — antes de esto,
// unlockAchievement() se llamaba a mano desde 13+ archivos distintos; cada integración
// nueva entre sistemas significaba ir a tocar el archivo fuente de la feature de origen.
// Este bus es el primer consumidor real (ver achievements.js), pensado para poder sumar
// más eventos de dominio después sin rediseñar nada.
// VERIFICACIÓN: cualquier comando que dispare un logro (/daily, /work, /trivia, /guess,
// /buy, /encuesta, /pet, sorteos, salas de voz, subida de nivel) tiene que seguir
// anunciando el logro exactamente igual que antes de esta migración.
//
// Nota sobre el diseño: a diferencia del pseudocódigo típico de "try/catch alrededor de
// la llamada al handler", acá el try/catch envuelve el `await handler(payload)` — un
// handler async no tira sincrónicamente, rechaza una promesa, así que un try/catch que
// no la espere nunca la atraparía y Promise.allSettled la tragaría en silencio sin
// loguear nada. Envolviendo el await, cualquier handler roto queda aislado (no tumba a
// los demás) Y queda logueado, que es el punto de aislar errores en primer lugar.
export class EventBus {
  constructor() {
    this.handlers = new Map(); // event -> [handler, handler, ...]
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  async emit(event, payload) {
    const handlers = this.handlers.get(event) || [];
    await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler(payload);
        } catch (error) {
          console.error(`❌ Error en handler de ${event}:`, error);
        }
      }),
    );
  }
}

export const eventBus = new EventBus();
