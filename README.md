# Oficina de agentes

Una oficina 3D en tu navegador donde ves trabajar a tus agentes de **Claude Code** y **Antigravity** (App, CLI e IDE) en tiempo real: cada agente (el principal y cada subagente) es una persona que entra por la puerta, se sienta en su escritorio cuando trabaja, levanta la mano cuando te necesita, descansa en la sala cuando está libre y celebra antes de irse cuando termina.

Todo corre en tu equipo y usa tus propias sesiones de Claude Code y/o Antigravity. Esta oficina **solo observa**: no consume cuota ni modelo propio, y ambos tipos de agentes pueden convivir en la misma oficina al mismo tiempo.

## Cómo funciona

```
Claude Code  ──(hooks HTTP / comando)──┐
                                       ├──▶ server.js ──(SSE)──▶ navegador (Three.js)
Antigravity  ──(hooks.json + script)───┘
```

Cada plataforma avisa de cada evento (usó una herramienta, arrancó un subagente, terminó, necesita tu respuesta o permiso…) mediante **hooks**. El servidor los recibe, guarda el estado de cada agente solo en memoria y lo empuja a la página.

## Inicio rápido

Necesitas **Node 18 o superior**. No hay que instalar nada más (Three.js ya viene incluido).

1. **Enciende la oficina**
   ```
   node server.js
   ```
   y abre http://localhost:4317. Si quieres ver cómo luce sin conectar agentes, pulsa **Ver demostración** (o arranca con `node server.js --demo`).

2. **Instala los hooks** (en otra terminal)

   - **Solo Claude Code** (añade los hooks a `~/.claude/settings.json`):
     ```
     node instalar-hooks.mjs --usuario
     ```
   - **Solo Antigravity** (App, CLI e IDE; añade `"oficina-agentes"` a `~/.gemini/config/hooks.json`):
     ```
     node instalar-hooks.mjs --antigravity --usuario
     ```
     (o `npm run instalar-antigravity`)
   - **Claude Code y Antigravity juntos**:
     ```
     node instalar-hooks.mjs --todos --usuario
     ```
     (o `npm run instalar-todos`)

   Nunca borra tus hooks existentes y deja una copia `*.bak-oficina` si el archivo ya existía. Si prefieres instalar solo en un proyecto:
   - Claude Code: `node instalar-hooks.mjs --proyecto ruta/del/proyecto` (`.claude/settings.json`)
   - Antigravity: `node instalar-hooks.mjs --antigravity --proyecto ruta/del/proyecto` (`.agents/hooks.json`)
   - Ambos: `node instalar-hooks.mjs --todos --proyecto ruta/del/proyecto`

3. **Abre Claude Code o Antigravity** (App, CLI, VS Code o IDE) y pide algo. Escribe `/hooks` para confirmar que aparecen los de la oficina.

Para quitarlos:
- Claude Code: `npm run quitar-hooks` (`node instalar-hooks.mjs --usuario --quitar`)
- Antigravity: `npm run quitar-antigravity` (`node instalar-hooks.mjs --antigravity --usuario --quitar`)
- Ambos: `npm run quitar-todos` (`node instalar-hooks.mjs --todos --usuario --quitar`)
- En un proyecto: añade `--quitar` al mismo comando con `--proyecto ruta/del/proyecto`.

## Probarlo con varios agentes

En **Claude Code**, copia los ejemplos a tu proyecto:

```
mkdir -p .claude/agents
cp ejemplo-subagentes/*.md .claude/agents/
```

Y pídele algo como:

> Usa el subagente `planificador` para dividir esta tarea. Luego lanza dos `ejecutor` en paralelo, uno por cada parte independiente, y al final pasa el `revisor`.

En **Antigravity**, cualquier conversación principal aparece en color cian; cuando delega en subagentes (`invoke_subagent`) o coordina un equipo (`/swarm`), sus subagentes aparecen vinculados junto a su escritorio y salen al terminar.

## Qué significa lo que ves

| Estado | Escritorio | Baliza sobre la cabeza | Persona |
|---|---|---|---|
| Trabajando | pantalla encendida con código | azul | teclea |
| Necesita tu atención | pantalla ámbar | ámbar, pulsa | levanta la mano |
| Libre | pantalla apagada | gris | descansa en la sala |
| Terminó (subagente) | — | verde | salta y sale por la puerta |
| Error | pantalla roja | roja | sigue en su sitio |

El color de la camiseta distingue el rol: **Claude** principal es azul índigo, **Antigravity** principal es cian, y los subagentes comparten color según su rol (todos los `ejecutor` llevan el mismo color). El tablero de la pared izquierda resume cuántos trabajan, esperan o están libres.

**Controles:** arrastra para girar, rueda para acercar, clic derecho para desplazar. Clic en una persona (o en la lista) para seguirla; `Esc` para soltarla.

## Opciones

| Qué | Cómo |
|---|---|
| Cambiar el puerto | `PORT=4400 node server.js` y luego `node instalar-hooks.mjs --todos --usuario --puerto 4400` |
| **Modo privado** (no muestra comandos, rutas ni textos) | `node server.js --sin-detalle` |
| **Modo ahorro** (menor consumo de GPU/batería) | pulsa **Ahorro** en la barra superior derecha (30 FPS, sin sombras ni blur; también pausa automáticamente al cambiar de pestaña) |
| Ajustar luces o velocidad | constantes al inicio de `public/office.js` (`LIGHT`, `WALK_SPEED`) |
| Más de 12 escritorios | cambia `DESK_COLS` / `DESK_ROWS` en `public/office.js` (los sobrantes trabajan de pie en la sala) |

## Si algo no funciona

- **No aparece nadie.** Comprueba que el servidor recibe eventos: abre http://localhost:4317/api/state mientras usas Claude Code o Antigravity. Si sigue vacío, escribe `/hooks` en la CLI (o revisa *Settings > Customizations > Hooks* en Antigravity App/IDE) para confirmar que los hooks están activos, y abre una sesión nueva.
- **Tu organización restringe los hooks HTTP en Claude Code.** Prueba con `node instalar-hooks.mjs --usuario --comando`, que usa un comando local en vez de una llamada HTTP. (Antigravity ya usa modo comando por defecto.)
- **Se ve en blanco.** La página necesita WebGL (Chrome, Edge, Firefox o Safari actualizados, con aceleración por hardware).
- **Letra distinta.** La tipografía se descarga de Google Fonts; sin internet se usa la del sistema y todo funciona igual.
- **Puerto ocupado.** Usa otro con `PORT=...` (ver Opciones).

Si el servidor está apagado cuando Claude Code o Antigravity intentan avisarle, ambos siguen funcionando con normalidad (el fallo del hook no bloquea nada), así que puedes dejar los hooks instalados.

## Privacidad y seguridad

- El servidor escucha **solo en 127.0.0.1** y rechaza peticiones cuyo `Host` no sea local.
- No guarda nada en disco: el estado vive en memoria y se pierde al apagarlo.
- La página muestra fragmentos de lo que hacen los agentes (comandos, rutas, el inicio de tu mensaje). Si vas a compartir pantalla, usa `--sin-detalle`.
- Los hooks son **solo de observación**: en Claude Code responden vacío ("sin decisión") y en Antigravity responden `{"decision":"allow"}` en `PreToolUse` (que delega a tu política normal de permisos, sin auto-aprobar ni bloquear acciones) y `{"decision":"stop"}` en `Stop`.

## Pruebas

```
node test/smoke.mjs
```
Comprueban la lógica del servidor (Claude Code y Antigravity), el HTTP/SSE, el instalador de hooks, el script `enviar-evento.mjs` y la escena 3D (construcción, caminos, posturas y que nadie atraviese escritorios), sin necesidad de navegador.

## Limitaciones conocidas

- En Claude Code, los eventos se asocian a un subagente por su `agent_id`. Si algún evento de subagente llegara sin ese dato, la oficina lo trata con cuidado (no lo mezcla con el principal), pero podría mostrar un compañero de más hasta que termine.
- En Antigravity no existe un evento `SessionEnd`, por lo que al terminar su turno el agente principal queda libre en la sala de descanso hasta que inicies otro turno (o se limpia automáticamente tras varias horas de inactividad).
- Las personas esquivan escritorios siguiendo pasillos fijos; si dos coinciden en un pasillo pueden cruzarse visualmente.
- Está pensada para unas 12 personas a la vez; con más, las extras trabajan de pie en la sala de descanso.
