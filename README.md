# Agentes de programación en Cloudflare Sandbox

Runner para **Pi y OpenCode**, con un sandbox Linux por tarea y un proveedor de modelos compatible con OpenAI elegido por ti. **No requiere AI Gateway.**

El endpoint ya está configurado como `https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1` y el modelo como `qwen3.7-flash`, según lo indicado por el usuario. La API key ya se cargó como secreto en Cloudflare y ambos agentes completaron una prueba real con este modelo.

## Mejorar este proyecto con sus propios agentes

El código está en [gilbertsahumada/cf-sandbox-coding](https://github.com/gilbertsahumada/cf-sandbox-coding). El flujo de trabajo, la primera tarea y los límites actuales están en [docs/SELF_IMPROVEMENT.md](docs/SELF_IMPROVEMENT.md). Cada mejora produce un patch revisable; no hay merges ni despliegues automáticos.

La conexión GitHub y la clonación de un repositorio privado autorizado están verificadas en producción. La descarga conserva las credenciales fuera del sandbox.

## Interfaz web

Abre [Sandbox](https://cf-sandbox-coding.gilbertsahumada.workers.dev) y pulsa **Conectar**. Introduce el valor de `RUNNER_API_TOKEN` de tu archivo local `.dev.vars`; no uses la API key de Qwen.

1. Pulsa **Nueva sesión** y elige Pi u OpenCode.
2. Conecta GitHub, autoriza los repositorios y elige uno en el selector. Puedes buscar entre públicos y privados y especificar una rama o etiqueta.
3. Describe la tarea y pulsa **Iniciar sesión de trabajo**.
4. Responde en el panel **Agente** para continuar con el mismo agente, contexto y repositorio. Sigue la actividad y revisa **Cambios**. Al terminar, pulsa **Crear PR**, completa el título y la descripción y publica un borrador. También puedes descargar el patch.

El workspace usa React, Vite y componentes shadcn/ui (Radix Nova). A la izquierda están las sesiones recientes y los archivos modificados; el centro muestra el diff por archivo con números de línea; a la derecha está el chat. Los paneles se pueden redimensionar y la actividad de herramientas se puede plegar. En móvil se alternan Sesiones, Cambios y Chat. Los estados de sesión usan iconos distintos y spinners mientras trabajan; el buscador y el chat usan Input Group, y los atajos usan Kbd. La recuperación de archivos y conversación muestra Skeletons mientras espera datos. La actividad usa Collapsible y mantiene los logs montados al plegarla. El explorador recorre el repositorio completo de la sesión y el editor permite guardar cambios manuales; la vista Changes conserva el diff acumulado.

Desarrollo de la interfaz:

```sh
npm run dev           # Compila la interfaz y abre el Worker local.
npm run dev:ui        # Vite con recarga; requiere el Worker local en :8787.
npm run preview:editor # Interfaz con datos simulados en :8795, sin claves ni red externa.
# Para comprobar loaders y estados intermedios:
npm run preview:editor -- --slow
```

El build escribe los recursos en `dist/ui`; `npm run deploy` lo ejecuta antes de Wrangler. En desarrollo con Wrangler, vuelve a compilar la UI después de editarla; Vite ofrece recarga inmediata en un segundo proceso. Las fuentes IBM Plex se sirven desde el mismo origen y la CSP mantiene bloqueados los scripts y estilos inline. La previsualización simulada usa `fixture-runner-token` únicamente si pruebas cerrar y abrir su sesión local; nunca introduces claves reales allí.

La sesión usa una cookie `HttpOnly`, `Secure` y `SameSite=Strict` de ocho horas. La API continúa aceptando Bearer para el cliente de terminal. El token no se guarda en localStorage; el historial conserva las últimas 12 tareas en este navegador. Para tareas privadas solo conserva el identificador, agente, tiempos y estado; no guarda nombres de repositorios, ramas, instrucciones, logs ni cambios. Los nombres privados se sustituyen por una etiqueta genérica y esas entradas se eliminan al cerrar sesión. Un enlace `/?task=ID` permite recuperar una tarea existente después de autenticarte. Los resultados se consultan al servidor al seleccionarlas. El botón de cierre de sesión limpia los resultados visibles; una tarea en curso sigue ejecutándose en su sandbox.

La actividad llega por SSE en una conexión autenticada, sin consultar logs periódicamente. La interfaz añade comandos, resultados y texto progresivo según llegan. OpenCode emite sus herramientas y resultados desde su stream de eventos; Pi usa sus eventos JSON. La conexión se recupera automáticamente desde los últimos offsets de salida recibidos; recargar vuelve a reproducir la salida disponible sin iniciar otro agente. Cerrar la pestaña solo detiene el observador de logs, no la tarea. El botón **Detener tarea** cancela la ejecución y guarda los logs y cambios cuando es posible. El estado **Detenida** distingue una cancelación de un fallo. Tools muestra comandos y resultados como texto. Las respuestas del agente se presentan como Markdown en el chat y en Response, con bloques de código, tablas y copia de código; el HTML y las imágenes remotas no se ejecutan ni cargan. Los diffs conservan texto literal. La interfaz permite una tarea nueva a la vez por navegador y conserva el historial al recargar. Cada respuesta del agente deja el estado **Respuesta lista**, con el chat esperando tu siguiente mensaje. Si cierras la página antes de que se envíe la instrucción al agente, inicia una tarea nueva.

La página y sus archivos estáticos son públicos; todas las operaciones y resultados requieren autenticación. Las solicitudes que modifican datos mediante cookies exigen el mismo origen. La clave del modelo nunca se envía al navegador.

## Conectar GitHub

La conexión usa una **GitHub App propia**, creada desde un manifiesto, con `Contents: write`, `Pull requests: write` y `Metadata: read` para publicar propuestas desde el Worker. La clonación continúa usando tokens de solo lectura. No usa ni copia la sesión de `gh` del equipo ni solicita el scope OAuth `repo`.

1. Inicia sesión en el runner y pulsa **Conectar GitHub**.
2. GitHub te pedirá crear la app propuesta, con un nombre único. Esta configuración se hace una sola vez; no tienes que copiar claves.
3. Instala la app en la cuenta que contiene tus repositorios y elige cuáles autorizar.
4. Al regresar, el selector mostrará los repositorios autorizados, con etiquetas **Público** o **Privado**. Para más de 100 repositorios usa **Cargar más repositorios**; la búsqueda filtra los repositorios ya cargados.

La interfaz recuerda el último repositorio elegido en Cloudflare y lo recupera seleccionado al volver a abrirla, aunque no esté en la primera página del catálogo. Solo se guardan sus identificadores de instalación y repositorio; la recuperación valida el acceso con GitHub y obtiene sus metadatos actuales. Desconectar GitHub elimina esa preferencia.

La app se registra como privada: solo se instala en la cuenta que la posee. Para repositorios propiedad de otra persona u organización hace falta una instalación autorizada por esa cuenta; esta conexión personal no hereda automáticamente todos los accesos de colaborador de tu usuario.

Las claves de la GitHub App se guardan en el Durable Object `GITHUB`, dentro de Cloudflare. El navegador recibe únicamente metadatos del catálogo, nunca tokens o claves privadas. Cada clon usa un token de instalación de corta duración restringido al repositorio seleccionado. El proxy del Worker permite exclusivamente `git-upload-pack` de ese repositorio y bloquea pushes, otros repositorios y otras rutas de GitHub. La URL guardada en `.git/config` no contiene credenciales.

El callback exige un estado aleatorio, temporal y vinculado a una cookie protegida del navegador. Esta cookie usa `SameSite=Lax` para el retorno desde GitHub; la sesión del runner mantiene `SameSite=Strict`. Los estados se consumen al completar el flujo y las credenciales de registro permanecen en el servidor.

**Desconectar** elimina las instalaciones conectadas y solicita a GitHub revocarlas. La identidad de la app se conserva para volver a instalarla sin crear otra. Si GitHub no permite revocar alguna instalación, la interfaz lo indica y el runner bloquea de todos modos la emisión de nuevos tokens. Puedes revisar o desinstalar la app en [las instalaciones de GitHub](https://github.com/settings/installations).

El runner sigue siendo para un único operador: cualquier persona con `RUNNER_API_TOKEN` tiene el mismo acceso al catálogo y a las tareas. Autoriza solo los repositorios con los que quieras trabajar; el agente enviará al proveedor Qwen el contexto que necesite cuando lances una tarea.

## Crear pull requests

El botón **Crear PR** aparece al terminar una tarea de un repositorio elegido mediante GitHub. Revisa el diff, escribe un título y describe los cambios y las pruebas. El Worker crea un commit sobre el commit inicial, una rama `sandbox/ID-DE-TAREA` y un PR **en borrador** hacia la rama de origen. El enlace se recupera al recargar. Los reintentos reutilizan la rama y el PR; una rama con contenido distinto nunca se sobrescribe. No hay merges ni despliegues automáticos.

Para una GitHub App ya instalada, abre **Configurar permisos de la app** en el diálogo y cambia **Contents** y **Pull requests** a **Read and write**. Guarda y aprueba los permisos nuevos en **Revisar instalación**. Cambiar el manifiesto del código no actualiza una instalación existente. [GitHub requiere aprobar los nuevos permisos](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app).

El token de escritura se emite solo en el Worker al pulsar el botón, restringido al ID del repositorio elegido. El agente conserva acceso de lectura y nunca recibe ese token. Se conservan los archivos modificados en el Durable Object antes de apagar el contenedor, incluidos binarios, enlaces simbólicos, permisos ejecutables y eliminaciones. El límite es 200 archivos y 5 MB de contenido. Los cambios en workflows, archivos con nombres de credenciales y conversiones entre archivo y directorio requieren revisión/publicación local con el patch. Las plantillas `.env.example` y `.dev.vars.example` están permitidas; la detección por nombre no sustituye revisar el diff.

Las tareas antiguas sin archivos exportados o sin rama de origen no pueden convertirse automáticamente: descarga su patch o ejecuta una tarea nueva. Las tareas detenidas o fallidas pueden publicarse como borrador si conservaron archivos, con su estado indicado en la descripción. El resultado del agente no se presenta como prueba independiente de que los checks pasaron.

## Configurar el proveedor

```sh
npm install
npm run configure -- https://api.proveedor.com/v1 identificador-del-modelo
npm run types
```

Por defecto usa Chat Completions y autenticación `Authorization: Bearer`. Si el proveedor ofrece Responses en su lugar:

```sh
npm run configure -- https://api.proveedor.com/v1 identificador-del-modelo responses
```

El modelo debe soportar herramientas y streaming. Ajusta `MODEL_CONTEXT_WINDOW` y `MODEL_MAX_TOKENS` en `wrangler.jsonc` según sus límites. Los valores iniciales son 32768 y 4096; no representan capacidades comprobadas del modelo que elijas.

Carga la clave como secreto del Worker; no la pegues en el chat ni la guardes en el repositorio:

```sh
npx wrangler secret put MODEL_API_KEY
npx wrangler secret put RUNNER_API_TOKEN
```

El segundo secreto es un token largo aleatorio que protege esta API. Este runner es para un único operador: quien tenga ese token puede acceder a todas sus tareas.

Ya se preparó `.dev.vars` con un token aleatorio para el runner; completa únicamente `MODEL_API_KEY`. En una instalación nueva copia `.dev.vars.example` a `.dev.vars` y completa ambos secretos. El archivo está excluido de Git y del contexto de Docker.

## Desplegar

Necesitas Workers Paid y Docker funcionando. `wrangler.jsonc` apunta a la cuenta detectada en esta sesión; cámbiala si corresponde.

```sh
npx wrangler login
npm run deploy
```

La sesión de Wrangler ya se renovó con permisos de Containers y el runner está desplegado en `https://cf-sandbox-coding.gilbertsahumada.workers.dev`. El endpoint también está guardado en `runner.json`. Desplegar construye una imagen Linux amd64 con Pi 0.87.1 y OpenCode 1.18.32.

## Ejecutar una tarea

El cliente lee la URL desde `runner.json` y el token desde `.dev.vars`. Puedes reemplazarlos con las variables de entorno `WORKER_URL` y `RUNNER_API_TOKEN`. Ejecuta:

```sh
npm run task -- pi https://github.com/owner/repo "Corrige el fallo y ejecuta las pruebas. No hagas commit."
npm run task -- opencode https://github.com/owner/repo "Añade pruebas para el parser. No hagas commit."
```

El cliente crea un nombre único, clona el repositorio, lanza el agente, consulta su estado y muestra el resultado y el diff. El cliente de terminal admite URLs públicas de GitHub. La API y la interfaz también permiten repositorios privados autorizados mediante la GitHub App.

## API

Las rutas de operaciones exigen `Authorization: Bearer <RUNNER_API_TOKEN>` o una sesión web válida. La interfaz estática es pública.

| Método | Ruta | Cuerpo / resultado |
| --- | --- | --- |
| GET | `/` | Interfaz web pública |
| POST | `/session` | Iniciar sesión con Bearer y Origin del mismo sitio; devuelve cookie protegida |
| GET | `/session` | Comprobar sesión |
| DELETE | `/session` | Cerrar sesión |
| GET | `/github/status` | Estado de la conexión, sin credenciales |
| POST | `/github/connect` | Iniciar registro o instalación; retorno vinculado al navegador |
| GET | `/github/repositories?page=1` | Catálogo paginado de repositorios autorizados |
| GET | `/github/selected-repository` | Recuperar el repositorio recordado, validando su acceso actual |
| PUT | `/github/selected-repository` | Recordar `{ "installationId": 123, "repositoryId": 456 }` después de comprobar acceso |
| DELETE | `/github/connection` | Desconectar y revocar instalaciones |
| GET | `/health` | Estado del Worker y agentes disponibles |
| POST | `/sandboxes/:id/repository` | URL pública o `{ "installationId": 123, "repositoryId": 456, "ref": "main" }`; `ref` opcional |
| POST | `/sandboxes/:id/task` | JSON `{ "agent": "pi", "prompt": "..." }`; también acepta `opencode` |
| GET | `/sandboxes/:id/messages` | Conversación, turno actual, disponibilidad para continuar y estado del punto de recuperación |
| POST | `/sandboxes/:id/messages` | `{ "id": "UUID", "prompt": "..." }`; continúa la sesión nativa; reutiliza el mismo ID si reintentas |
| GET | `/sandboxes/:id/task` | `none`, `running`, `stopping`, `cancelled`, `lost`, `succeeded` o `failed` |
| DELETE | `/sandboxes/:id/task` | Cancelar el grupo de procesos, archivar logs y diff cuando sea posible y detener el contenedor; conserva resultados ya archivados |
| GET | `/sandboxes/:id/logs` | Últimos 32 KB de stdout y stderr |
| GET | `/sandboxes/:id/events` | SSE de stdout, stderr y estado; reconexión con `Last-Event-ID` o `?cursor=stdoutBytes:stderrBytes` |
| GET | `/sandboxes/:id/pull-request` | Disponibilidad, motivo de bloqueo o enlace al PR existente |
| POST | `/sandboxes/:id/pull-request` | `{ "title": "...", "description": "..." }`; crea una propuesta en borrador |
| GET | `/sandboxes/:id/files` | List a directory with `?path=...&cursor=0`; pages contain up to 200 entries |
| GET | `/sandboxes/:id/file` | Read a UTF-8 file with `?path=...`, including its content revision |
| PUT | `/sandboxes/:id/file` | Save `{ "path": "...", "content": "...", "version": "..." }` with optimistic conflict detection |
| GET | `/sandboxes/:id/diff` | Patch Git, incluidos archivos nuevos y binarios |

Cada sandbox mantiene una sola tarea con hasta 100 turnos de conversación. Usa otro nombre para una tarea nueva. El diff se calcula contra el commit inicial, aunque el agente cree commits durante su ejecución.

## Ejecución y conservación de resultados

- La tarea corre en segundo plano; una alarma cada minuto mantiene activo su Durable Object.
- Límite de ejecución: 30 minutos por turno. La instancia usa `standard-1`.
- Al terminar, la siguiente alarma conserva resultado, cola de logs y diff en el almacenamiento del Durable Object. Después permite que el contenedor se detenga por inactividad.
- El mensaje final se limita a los últimos 16000 caracteres. El diff se almacena por fragmentos, sin truncarlo deliberadamente.
- Las nuevas conversaciones conservan un punto de recuperación del repositorio completo (incluido `.git`), la configuración del agente y sus archivos nativos de sesión al terminar cada turno. Se guarda comprimido y fragmentado en el Durable Object, con comprobación de integridad; el límite es 20 MB comprimidos. La recuperación mantiene el mismo directorio del repositorio y la misma sesión.
- Si el punto de recuperación falla, la interfaz lo advierte y mantiene el entorno abierto hasta 30 minutos por inactividad. No se promete recuperación de un turno interrumpido por una pérdida inesperada antes de guardarlo. Los archivos fuera del repositorio y de los directorios de sesión/configuración no forman parte del punto guardado.
- Los resultados archivados permanecen hasta que se elimine su Durable Object; esta versión no incluye limpieza automática.

## Red y credenciales

El contenedor no recibe la API key real. Pi y OpenCode usan una clave ficticia; el Worker la sustituye al salir hacia el origen y ruta exactos configurados. No sigue redirecciones con la credencial.

La red solo permite GitHub (restringido a la lectura del repositorio elegido en tareas de la conexión) y los endpoints del modelo (`/chat/completions` o `/responses`). npm, PyPI y otros destinos están bloqueados: prepara las dependencias necesarias en el Dockerfile. El código del repositorio puede utilizar la API del modelo a través del proxy, aunque no pueda leer su clave. El aislamiento no impone un presupuesto de tokens.

El agente y el código del repositorio comparten el sandbox: los archivos, logs y resultados son datos no confiables. La lectura de un diff durante una tarea es una vista provisional.

## Verificación

Verificado en esta sesión: compilación TypeScript, 49 pruebas automáticas, autenticación HTTP local, construcción de la imagen, ejecución de herramientas con Pi y OpenCode contra un servidor de prueba y empaquetado de Wrangler sin despliegue. También verificadas dos tareas reales en Cloudflare con Qwen: Pi y OpenCode crearon el archivo solicitado y su diff incluyó el contenido esperado. Evidencia en `verification/pi.json`, `verification/pi.diff`, `verification/opencode.json` y `verification/opencode.diff`.

```sh
npm run check
npm test
npm run build
npx wrangler deploy --dry-run --outdir dist
docker build --platform linux/amd64 -t cf-sandbox-coding:local .
docker run --rm --platform linux/amd64 --network none -v "$PWD/scripts/smoke-container.mjs:/test.mjs:ro" cf-sandbox-coding:local node /test.mjs
```

OpenCode se controla mediante `opencode serve` y su API HTTP local: el adaptador espera la respuesta de la sesión y apaga el servidor. Así la tarea no queda pendiente por servicios auxiliares del CLI.

La prueba de contenedor usa un servidor OpenAI compatible simulado, sin claves ni peticiones a un proveedor externo. Esto comprueba configuración y herramientas, no la calidad del modelo ni una ejecución desplegada en Cloudflare.

La interfaz se probó en navegador con ambos agentes y Qwen, incluyendo sesión incorrecta/correcta, formulario, actividad, diff, cierre de sesión y recuperación del historial al recargar. También pasaron dos tareas en la versión publicada usando la cookie de sesión; ambos agentes emitieron eventos de herramientas. Resumen en `verification/web-session.json`. Capturas en `verification/web-interface.png` y `verification/web-interface-live.png`.

## Repetir la prueba desplegada

```sh
npm run verify:live -- https://cf-sandbox-coding.gilbertsahumada.workers.dev
# Mismo flujo usando la sesión web y comprobando el bloqueo de otros orígenes:
npm run verify:live -- https://cf-sandbox-coding.gilbertsahumada.workers.dev --session
```

Ejecuta una tarea breve con cada agente en un clon público de `octocat/Hello-World`. Consume API del modelo y recursos de Containers. Guarda los resultados y diffs en `verification/`; nunca imprime la API key.

## Referencias

La coordinación del contenedor se adapta del [runner oficial de Cloudflare](https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/), con adaptadores para [Pi](https://developers.cloudflare.com/sandbox/coding-agents/pi/) y [OpenCode](https://developers.cloudflare.com/sandbox/coding-agents/opencode/).

Proveedor personalizado: [Pi models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) y [OpenCode providers](https://opencode.ai/docs/providers/).

## Verificar SSE y cancelación

```sh
npm run verify:sse
```

Ejecuta dos tareas controladas con Qwen sobre el repositorio público `octocat/Hello-World`. Comprueba que llegan eventos antes de terminar, que desconectar y reconectar el observador no cancela Pi y que detener OpenCode conserva el cambio de prueba. Al terminar apaga ambos contenedores. Guarda solo métricas en `verification/sse-live.json`; consume recursos de Containers y del proveedor del modelo.

Durante la ejecución se leen los archivos de salida completos con offsets de bytes. Una vez apagado el contenedor, la recuperación muestra la cola archivada de hasta 32 KB por canal y lo indica en la interfaz. El navegador no guarda logs, diffs ni cursores de contenido en localStorage. La vista limita el volumen de texto visible para evitar crecimiento indefinido de memoria.

Verificación SSE en Cloudflare: Pi recibió eventos antes de completar y continuó tras desconectar el observador; la reconexión completó la tarea. OpenCode se canceló mientras ejecutaba una herramienta y conservó `sse-check.txt` en el diff archivado. Ambas instancias se apagaron al finalizar. Métricas en `verification/sse-live.json`; prueba de interfaz con datos simulados en `verification/sse-browser.json`.

La creación de propuestas se verificó con repositorios Git locales y respuestas de GitHub simuladas: binarios, eliminación, renombre, modos, enlaces simbólicos, commit del agente, reintentos y conflicto de rama. La interfaz se probó con datos simulados, incluyendo error de permisos, reintento y recuperación del enlace al recargar (`verification/pr-ui.png`). La publicación real desde la GitHub App queda pendiente de aprobar sus permisos de escritura.

## Conversaciones con Pi y OpenCode

El chat separa tus mensajes y las respuestas del agente de los logs de herramientas. Mientras el agente trabaja, puedes preparar una respuesta; el envío se habilita al terminar. Para cambiar de dirección antes, pulsa **Detener tarea** y envía la siguiente instrucción. La cancelación guarda el entorno cuando es posible antes de apagarlo; no borra la conversación ni los cambios.

Pi usa `--session-id task --session-dir /workspace/conversation/pi` en lugar de `--no-session`. OpenCode guarda su ID de sesión y base de datos local bajo `/workspace/conversation` y vuelve a enviar a esa sesión mediante su [API de mensajes](https://opencode.ai/docs/server/#messages). Una sesión guardada inválida produce un error; no se reemplaza silenciosamente por una conversación vacía. Los tokens siguen fuera del contenedor.

La API serializa los turnos y rechaza un envío nuevo mientras el agente está activo. Los UUID de mensajes evitan repetir un turno si se pierde la respuesta HTTP. El navegador conserva un ID de reintento en memoria, sin guardar instrucciones ni respuestas en localStorage. Las pestañas del mismo navegador notifican cambios mediante identificadores de tarea; SSE distingue cada turno para no reproducir offsets anteriores sobre logs nuevos. Cerrar sesión limpia el chat visible.

Cada turno invalida los caches de diff y propuesta para que **Cambios** muestre el acumulado contra el commit inicial. Crear PR publica el acumulado del turno actual; los turnos posteriores pueden crear otro borrador, con una rama distinta, sin sobrescribir un PR anterior.

Las tareas ejecutadas antes de esta función no guardaron sesiones nativas ni puntos de recuperación y muestran el chat deshabilitado con una explicación. Sus resultados y patches archivados siguen disponibles. Los mensajes aún no enviados no se guardan al recargar.

Prueba local de continuación sin claves ni red externa:

```sh
docker build --platform linux/amd64 -t cf-sandbox-coding:chat .
docker run --rm --platform linux/amd64 --network none -v "$PWD/scripts/smoke-chat.mjs:/test.mjs:ro" cf-sandbox-coding:chat node /test.mjs
```

Verificado con ambos CLI reales y un proveedor simulado: dos turnos, recuerdo de un dato presente solo en el primer mensaje, restauración del workspace y conservación de los dos archivos modificados. No se ha verificado todavía esta continuación con Qwen en Cloudflare. Prueba de navegador con datos simulados: respuesta HTTP perdida, reintento con un único turno nuevo y conversación recuperada al recargar (`verification/chat-ui.png`).

## Verificación del nuevo workspace

La migración a React y shadcn conserva la API del runner. Sus pruebas de navegador usan `scripts/preview-editor.mjs`, con respuestas y SSE simulados: restaurar una tarea por enlace, continuar el chat y recuperar sus turnos al recargar, crear una sesión OpenCode, detenerla, recordar el repositorio, paginar el catálogo, revisar archivos y reintentar un PR después de un error. También se verificaron los estados de envío con latencia simulada, la navegación compacta Chat/Cambios y la reapertura de los logs. Esta verificación no ejecuta agentes reales ni publica propuestas en GitHub. Las pruebas automáticas cubren los paths y números de línea del diff, eventos de texto del asistente, enlaces de PR y los recursos estáticos bajo la CSP.


## Repository explorer and editing

Files lists the actual cloned repository inside the selected cloud session. Directories load on demand, including files outside the agent's patch. Open files in tabs, edit with syntax highlighting, and use Save or Cmd/Ctrl+S. Code and Changes switch between the source editor and the cumulative diff. Icons and conversation messages use neutral styling; syntax and diff colors convey code meaning.

Saving is available after the agent finishes or stops. It writes into the same workspace, refreshes the cumulative patch and PR proposal, and updates the durable checkpoint. The next Pi or OpenCode turn receives the manually edited paths and continues its native session. Saves after publishing invalidate the cached PR and use a new publication branch. An expired container is restored from its current checkpoint when possible; an old session with only an archived patch cannot provide a recoverable editor.

Files must be regular UTF-8 text of at most 256 KB. Symbolic links, hard links, binary files, Git internals and recognized credential paths are protected. Linux directory descriptors prevent following substituted parent symlinks. A content revision prevents overwriting a concurrent edit: a conflict keeps your draft until you explicitly reload. Drafts stay in browser memory, survive file/session switches, and trigger a warning when leaving; save them before reloading. No source content or file paths are stored in localStorage. If checkpoint creation fails, the UI warns that the save exists only in the running workspace and offers a retry.

Local verification uses simulated API responses for explorer navigation, retained drafts, saving, full-page reload, two-tab conflicts, discard confirmation and Markdown rendering. Filesystem access and conflict handling were also checked in a real Linux container with networking disabled. These checks do not exercise the deployed Cloudflare file endpoints or run a real model turn with manual edits.


### Browser annotations in the simulated preview

The local `preview:editor` fixture allows inline style elements so Codex Annotate can draw its selection overlay. The diagnostic comparison confirmed that `style-src-elem` blocked those injected styles under the strict policy. Script execution remains restricted to the same origin; the fixture uses fake credentials and simulated APIs. The deployed Worker's CSP retains its nonce-based style policy. This exception belongs only to the simulated preview.


### Response code and session controls

Agent response fences highlight JavaScript, TypeScript, JSX and TSX using the same parser family as the source editor. Declared language aliases are normalized; plain-text or unlabelled fences use conservative code detection, leaving unsupported languages as literal text. Highlighting preserves the source text and renders escaped React nodes. The new-session form shows an explicit selection check and agent name. Its repository menu uses shadcn Select, retaining the loaded-repository search, pagination and remembered choice.

Verification for these controls uses the simulated preview: switching Pi/OpenCode changes the checked radio and selection label; starting an OpenCode fixture task confirms the selected agent reaches the request. Repository selection, search filtering and loading the complete catalog were checked in the custom menu. No real model task was started for these checks.


### Session preparation feedback and archived activity

A validated new session closes its dialog before the repository request completes and opens the session conversation on compact screens. The chat, editor, file explorer and tool activity show preparation, cloning and agent-start feedback; the session list and status bar retain their preparing state. Preparation failures keep the instruction visible in the session and in the form, with a workspace-level error. The Stop action is disabled until startup requests settle so it cannot race an agent launch. Local startup details remain in memory and are cleared on sign-out.

Archived activity explicitly explains its latest-32-KB limit. A leading event cut by the archival boundary is described as a skipped incomplete archived entry; tool failures remain errors and session status remains separate. Use `node scripts/preview-editor.mjs --slow-start` to inspect delayed preparation, or add `--fail-start` for a simulated clone failure. Fixture archived sessions replay a clipped leading event to verify the neutral message. These checks do not start real Cloudflare agents.


## Session-first workspace

Overview groups the recent sessions known to this browser by Working, Awaiting reply, and Previous sessions. The conversation is the default surface; Changes opens the repository explorer and source editor on demand, while Tools keeps the existing SSE activity mounted when switching views. Session details show actual task status, cumulative changes, publication actions, and checkpoint availability. A finished turn is not represented as an approval request or a verified test result.

New chat opens an empty conversation. The first nonempty message creates the cloud session and immediately shows preparation in that same conversation. Choose the repository and Pi/OpenCode in the composer; repository search, pagination, optional branch and GitHub connection live in its repository dialog. Enter sends and Shift+Enter inserts a new line. Opening the draft or changing settings does not create a task. The `?new=1` link opens the new-chat surface and is replaced by the task link after the first send. Session history searches up to 12 browser-known tasks; opening one refreshes its last-known status and recovery information. It is not an account-wide server catalog. Titles derived from loaded instructions stay only in browser memory, and private metadata keeps the existing storage redaction. Signing out clears form drafts and filters.

The layout uses compact 12px conversation text, smaller supporting labels, rounded panels and neutral selection borders without colored side stripes. On smaller screens, the rail switches between navigation, conversation, tools and contextual details. The editor, unsaved-file protection, PR publication, cancellation, authentication, and execution limits retain their existing behavior. This UI change does not enable additional concurrent executions.

Verification uses the local simulated preview for the new-session flow, delayed preparation, cancellation, reply drafts, history search, contextual file editing/saving, and responsive navigation. No real Cloudflare agent or model invocation is performed for this redesign. Run a separate delayed fixture with `PREVIEW_PORT=8797 node scripts/preview-editor.mjs --slow --slow-start`.
