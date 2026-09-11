// Curado a mano desde las fases reales documentadas en CLAUDE.md (con fecha) — NO desde
// git log crudo (82+ commits, muchos de trabajo interno/WIP que no le dicen nada a un
// cliente) y NUNCA con números de versión inventados (el repo no tiene tags ni
// CHANGELOG.md — package.json quedó fijo en 0.1.0 desde el primer commit). Cada entrada
// describe capacidades que siguen siendo ciertas HOY, en lenguaje de producto — no la
// jerga interna de la auditoría que la originó. Sistemas removidos (Música, Pets,
// Reportes) aparecen SOLO en el momento en que se sacaron, nunca como si siguieran
// disponibles.
export const CHANGELOG = [
  {
    date: '2026-09-11',
    title: 'Hardening de concurrencia',
    items: [
      'Endurecimiento de la economía y del aislamiento entre servidores frente a usos simultáneos.',
      'Limpieza más completa de datos cuando NEXO sale de un servidor.',
    ],
  },
  {
    date: '2026-09-10',
    title: 'Roles autoasignables y digest semanal',
    items: [
      'Roles que cualquier miembro puede tomar o soltar solo, sin pedirle nada a un moderador.',
      'Resumen semanal de actividad del servidor, opcional, a un canal de tu elección.',
      'Mejoras de concurrencia en /give y /rob — dos usos casi simultáneos del mismo comando ya no pueden pisarse entre sí.',
    ],
  },
  {
    date: '2026-09-05',
    title: 'Tres niveles de permisos de staff',
    items: [
      'Moderador, administrador y dueño — ya no todo el staff puede acreditar saldo o XP sin límite.',
      'El dashboard muestra la configuración real de tu servidor (roles, canales, módulos activos), no solo métricas.',
      'Alertas internas cuando algo falla de verdad, para no depender de que alguien esté mirando los logs en vivo.',
    ],
  },
  {
    date: '2026-09-04',
    title: 'Auditoría de seguridad completa',
    items: [
      'Revisión de permisos, datos y configuración contra el entorno real de producción.',
      'Cierre de un caso donde un motivo de sanción con @everyone podía notificar a todo el servidor.',
    ],
  },
  {
    date: '2026-09-03',
    title: 'Música removida del producto',
    items: [
      'Decisión de producto: reproducción de audio/Spotify sale de NEXO. Puede volver como proyecto aparte más adelante.',
    ],
  },
  {
    date: '2026-09-01',
    title: 'Recuperación automática de sorteos',
    items: [
      'Si el bot se reinicia justo después de elegir ganadores de un sorteo, el anuncio se retoma solo — nunca se repite ni se pierde.',
      'XP y prestigio protegidos contra condiciones de carrera cuando dos acciones llegan casi al mismo tiempo.',
      'Sistema de mascotas (Pets) removido del producto.',
    ],
  },
  {
    date: '2026-08-31',
    title: 'Moderación con restricciones temporales',
    items: [
      'Restricciones con duración (1h/6h/1d/7d) que se levantan solas, incluso si el bot se reinició en el medio.',
      'Jerarquía de roles real en moderación: nadie sanciona a alguien con un rol igual o superior al suyo.',
    ],
  },
  {
    date: '2026-08-30',
    title: 'Misiones y logros',
    items: [
      'Misiones diarias y semanales que se completan y pagan solas, sin ningún botón de "reclamar".',
      'Logros que se desbloquean automáticamente y se muestran en /perfil.',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Segunda auditoría completa',
    items: [
      'Correcciones de estabilidad y seguridad sobre moderación, economía y configuración por servidor.',
    ],
  },
  {
    date: '2026-08-23',
    title: 'Dashboard web',
    items: [
      'Panel de solo lectura para seguir la actividad, economía y moderación de tu servidor sin entrar a Discord.',
      'Acceso con tu cuenta de Discord — solo ves los servidores donde tenés el rol de staff.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Primera versión de NEXO',
    items: [
      'Un solo bot capaz de atender cualquier cantidad de servidores, cada uno con su propia configuración.',
    ],
  },
];
