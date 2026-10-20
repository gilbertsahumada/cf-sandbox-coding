# Agentes de programación en Cloudflare Sandbox

Runner para **Pi y OpenCode**, con un sandbox Linux por tarea y un proveedor de modelos compatible con OpenAI elegido por ti. **No requiere AI Gateway.**

El endpoint ya está configurado como `https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1` y el modelo como `qwen3.7-flash`, según lo indicado por el usuario. La API key ya se cargó como secreto en Cloudflare y ambos agentes completaron una prueba real con este modelo.

## Mejorar este proyecto con sus propios agentes

El código está en [gilbertsahumada/cf-sandbox-coding](https://github.com/gilbertsahumada/cf-sandbox-coding). El flujo de trabajo, la primera tarea y los límites actuales están en [docs/SELF_IMPROVEMENT.md](docs/SELF_IMPROVEMENT.md). Cada mejora produce un patch revisable; no hay merges ni despliegues automáticos.

La conexión real de GitHub sigue pendiente de reparación y verificación. Por ahora, un repositorio privado no puede seleccionarse hasta completar esa conexión.

## Interfaz web

Abre [Sandbox](https://cf-sandbox-coding.gilbertsahumada.workers.dev) y pulsa **Conectar**. Introduce el valor de `RUNNER_API_TOKEN` de tu archivo local `.dev.vars`; no uses la API key de Qwen.

1. Elige Pi u OpenCode.
2. Conecta GitHub, autoriza los repositorios y elige uno en el selector. Puedes buscar entre públicos y privados y especificar una rama o etiqueta.
3. Describe la tarea y pulsa **Ejecutar tarea**.
4. Sigue la actividad, revisa **Cambios** y descarga el patch si quieres aplicarlo localmente.

La sesión usa una cookie `HttpOnly`, `Secure` y `SameSite=Strict` de ocho horas. La API continúa aceptando Bearer para el cliente de terminal. El token no se guarda en localStorage; el historial guarda solo los identificadores y metadatos de las últimas 12 tareas públicas en este navegador. Los metadatos de tareas privadas solo permanecen en memoria de la pestaña y se eliminan de la interfaz al cerrar sesión. Los resultados se consultan al servidor al seleccionarlas. El botón de cierre de sesión limpia los resultados visibles; una tarea en curso sigue ejecutándose en su sandbox.

Los logs se actualizan cada 3,5 segundos. OpenCode emite sus herramientas y resultados desde su stream de eventos; Pi usa sus eventos JSON. La salida y los diffs se muestran como texto, sin interpretar HTML. La interfaz permite una tarea nueva a la vez por navegador y conserva el historial al recargar. Si cierras la página antes de que se envíe la instrucción al agente, inicia una tarea nueva.

La página y sus archivos estáticos son públicos; todas las operaciones y resultados requieren autenticación. Las solicitudes que modifican datos mediante cookies exigen el mismo origen. La clave del modelo nunca se envía al navegador.

## Conectar GitHub

La conexión usa una **GitHub App propia**, creada desde un manifiesto, con `Contents: read` y `Metadata: read`. No usa ni copia la sesión de `gh` del equipo ni solicita el scope OAuth `repo`.

1. Inicia sesión en el runner y pulsa **Conectar GitHub**.
2. GitHub te pedirá crear la app propuesta, con un nombre único. Esta configuración se hace una sola vez; no tienes que copiar claves.
3. Instala la app en la cuenta que contiene tus repositorios y elige cuáles autorizar.
4. Al regresar, el selector mostrará los repositorios autorizados, con etiquetas **Público** o **Privado**. Para más de 100 repositorios usa **Cargar más repositorios**; la búsqueda filtra los repositorios ya cargados.

La app se registra como privada: solo se instala en la cuenta que la posee. Para repositorios propiedad de otra persona u organización hace falta una instalación autorizada por esa cuenta; esta conexión personal no hereda automáticamente todos los accesos de colaborador de tu usuario.

Las claves de la GitHub App se guardan en el Durable Object `GITHUB`, dentro de Cloudflare. El navegador recibe únicamente metadatos del catálogo, nunca tokens o claves privadas. Cada clon usa un token de instalación de corta duración restringido al repositorio seleccionado. El proxy del Worker permite exclusivamente `git-upload-pack` de ese repositorio y bloquea pushes, otros repositorios y otras rutas de GitHub. La URL guardada en `.git/config` no contiene credenciales.

El callback exige un estado aleatorio, temporal y vinculado a una cookie protegida del navegador. Esta cookie usa `SameSite=Lax` para el retorno desde GitHub; la sesión del runner mantiene `SameSite=Strict`. Los estados se consumen al completar el flujo y las credenciales de registro permanecen en el servidor.

**Desconectar** elimina las instalaciones conectadas y solicita a GitHub revocarlas. La identidad de la app se conserva para volver a instalarla sin crear otra. Si GitHub no permite revocar alguna instalación, la interfaz lo indica y el runner bloquea de todos modos la emisión de nuevos tokens. Puedes revisar o desinstalar la app en [las instalaciones de GitHub](https://github.com/settings/installations).

El runner sigue siendo para un único operador: cualquier persona con `RUNNER_API_TOKEN` tiene el mismo acceso al catálogo y a las tareas. Autoriza solo los repositorios con los que quieras trabajar; el agente enviará al proveedor Qwen el contexto que necesite cuando lances una tarea.

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
| DELETE | `/github/connection` | Desconectar y revocar instalaciones |
| GET | `/health` | Estado del Worker y agentes disponibles |
| POST | `/sandboxes/:id/repository` | URL pública o `{ "installationId": 123, "repositoryId": 456, "ref": "main" }`; `ref` opcional |
| POST | `/sandboxes/:id/task` | JSON `{ "agent": "pi", "prompt": "..." }`; también acepta `opencode` |
| GET | `/sandboxes/:id/task` | `none`, `running`, `lost`, `succeeded` o `failed` |
| GET | `/sandboxes/:id/logs` | Últimos 32 KB de stdout y stderr |
| GET | `/sandboxes/:id/diff` | Patch Git, incluidos archivos nuevos y binarios |

Cada sandbox acepta una sola tarea. Usa otro nombre para una tarea nueva. El diff se calcula contra el commit inicial, aunque el agente cree commits durante su ejecución.

## Ejecución y conservación de resultados

- La tarea corre en segundo plano; una alarma cada minuto mantiene activo su Durable Object.
- Límite de ejecución: 30 minutos. La instancia usa `standard-1`.
- Al terminar, la siguiente alarma conserva resultado, cola de logs y diff en el almacenamiento del Durable Object. Después permite que el contenedor se detenga por inactividad.
- El mensaje final se limita a los últimos 16000 caracteres. El diff se almacena por fragmentos, sin truncarlo deliberadamente.
- El workspace completo no se conserva ni se restaura. Si la instancia se pierde antes de archivar, el estado es `lost` y los cambios pueden perderse.
- Los resultados archivados permanecen hasta que se elimine su Durable Object; esta versión no incluye limpieza automática.

## Red y credenciales

El contenedor no recibe la API key real. Pi y OpenCode usan una clave ficticia; el Worker la sustituye al salir hacia el origen y ruta exactos configurados. No sigue redirecciones con la credencial.

La red solo permite GitHub (restringido a la lectura del repositorio elegido en tareas de la conexión) y los endpoints del modelo (`/chat/completions` o `/responses`). npm, PyPI y otros destinos están bloqueados: prepara las dependencias necesarias en el Dockerfile. El código del repositorio puede utilizar la API del modelo a través del proxy, aunque no pueda leer su clave. El aislamiento no impone un presupuesto de tokens.

El agente y el código del repositorio comparten el sandbox: los archivos, logs y resultados son datos no confiables. La lectura de un diff durante una tarea es una vista provisional.

## Verificación

Verificado en esta sesión: compilación TypeScript, 18 pruebas automáticas, autenticación HTTP local, construcción de la imagen, ejecución de herramientas con Pi y OpenCode contra un servidor de prueba y empaquetado de Wrangler sin despliegue. También verificadas dos tareas reales en Cloudflare con Qwen: Pi y OpenCode crearon el archivo solicitado y su diff incluyó el contenido esperado. Evidencia en `verification/pi.json`, `verification/pi.diff`, `verification/opencode.json` y `verification/opencode.diff`.

```sh
npm run check
npm test
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
