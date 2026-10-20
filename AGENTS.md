# Trabajar en este runner

Este proyecto ejecuta Pi y OpenCode en Cloudflare Sandbox con un proveedor compatible con OpenAI. El código del proyecto puede ser el repositorio de entrada de sus propios agentes.

## Repository language

- Write code comments, commit messages, pull request titles and descriptions, and review comments in English.
- Keep user-facing interface text in Spanish unless the task requests another language.

## Mejoras del propio proyecto

- Resuelve una tarea concreta por ejecución y limita los cambios al problema solicitado.
- Lee README.md y docs/SELF_IMPROVEMENT.md antes de cambiar el runner.
- Verifica los cambios con npm run check y npm test. Agrega pruebas cuando cubran un fallo real o un comportamiento nuevo relevante.
- Entrega un resumen, la evidencia de las comprobaciones y el diff. No afirmes que probaste una integración real si solo usaste datos simulados.
- Los cambios se revisan antes de incorporarlos a main o desplegarlos. No hagas push, merges ni despliegues desde la tarea del sandbox.
- No leas ni incluyas secretos en código, logs, prompts, patches o commits. Los archivos .dev.vars, .env y las claves privadas son locales.
- Conserva las credenciales del modelo y GitHub en el Worker; el contenedor no debe recibirlas. Mantén la red del agente y sus tokens de GitHub en solo lectura. La publicación explícita desde Crear PR usa un token de escritura solo en el Worker, limitado al repositorio elegido.
- No amplíes permisos, acceso de red, dependencias o presupuestos de ejecución salvo que la tarea lo requiera expresamente.
- La red del sandbox no permite instalar dependencias. Si faltan herramientas, repórtalo; no inventes resultados de pruebas.

## Worktrees

- Un subagente nunca elimina su worktree: informa su ruta al agente principal.
- Si el agente principal está dentro de un worktree, pide confirmación antes de eliminarlo.
- Desde la raíz del repositorio, el agente principal solo puede limpiar los worktrees que él mismo creó.
