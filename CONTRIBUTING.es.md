# Contribuir

Gracias por tu interés en mejorar este proyecto. Este runner ejecuta agentes de codificación (Pi y OpenCode) dentro de Cloudflare Sandboxes con un proveedor de modelos compatible con OpenAI. Las contribuciones son revisadas antes de ser fusionadas o desplegadas — no hay fusiones ni despliegues automáticos.

## Cómo funcionan las contribuciones

El código base está alojado en [gilbertsahumada/cf-sandbox-coding](https://github.com/gilbertsahumada/cf-sandbox-coding). Usa la interfaz web del runner para asignar una tarea acotada a Pi u OpenCode contra este repositorio:

1. Autoriza este repositorio en la conexión de GitHub App del runner.
2. En la interfaz, selecciona este repositorio, elige Pi u OpenCode y proporciona una tarea acotada.
3. El agente trabaja en un clon aislado. Responde en el chat de la tarea para continuar con su contexto y cambios; los registros y el parche se actualizan cada turno.
4. Revisa la diferencia y presiona **Crear PR** para publicar una rama borrador (`sandbox/TAREA-ID`) y un pull request borrador desde el Worker. Describe las pruebas realizadas; verifica antes de aceptar la propuesta.
5. Incorpora los cambios después de la revisión, luego haz el despliegue. La siguiente tarea clonará la versión actualizada.

GitHub Actions verifica los commits y pull requests sin exposición de modelos ni credenciales de Cloudflare. No hay un ciclo de mejora continua que funcione sin una tarea definida, presupuesto y condición de detención.

## Estándares de código

- Escribe comentarios de código, mensajes de commit, títulos y descripciones de pull requests y comentarios de revisión en **inglés**.
- Mantén todo el texto visible para el usuario, etiquetas de accesibilidad, estados de carga y mensajes generados por la aplicación en **inglés**.
- Resuelve una tarea concreta por ejecución. Limita los cambios a lo necesario para esa tarea.
- No agregues secretos, claves API, tokens ni archivos privados al código, registros, prompts, parches o commits. `.dev.vars`, `.env` y las claves privadas deben permanecer locales.
- No amplíes permisos de red, alcances de acceso, dependencias ni presupuestos de ejecución a menos que la tarea lo requiera explícitamente.
- Mantén el acceso solo lectura para el agente y sus tokens de GitHub. El flujo explícito "Crear PR" usa un token de escritura limitado solo al repositorio seleccionado, emitido exclusivamente dentro del Worker.

## Código mantenible

- Mantén las constantes en el módulo que las posee. Comparte un objeto de configuración tipado solo cuando varios consumidores necesiten la misma política; mantienes los valores derivados locales donde corresponda.
- Deriva uniones de objetos de dominio inmutables cuando corresponda, usa tipos explícitos en los límites de la API y evita `any` o afirmaciones que oculten incertidumbre. Las afirmaciones de tipo no validan JSON no confiable en tiempo de ejecución.
- Preserva las claves de almacenamiento duradero, estados de tarea, políticas de red y contratos de redirección durante la refactorización. Una limpieza de nombres no debe migrar datos almacenados accidentalmente.
- Explica en los comentarios las decisiones no obvias de ciclo de vida, concurrencia y seguridad. Prefiere nombres claros sobre comentarios que repitan la implementación.
- Usa la configuración de Prettier fijada, indentación de dos espacios y una declaración por paso lógico. Las declaraciones generadas del Worker están excluidas del formato manual.
- Ambos proyectos de TypeScript se ejecutan en modo estricto y rechazan declaraciones/parámetros sin usar, caídas de switch fallthrough y mayúsculas inconsistentes en nombres de archivos.

## Desarrollo

```sh
npm install           # Instala las dependencias.
npm run format        # Aplica el formateador compartido.
npm run format:check  # Verifica el formato sin modificar archivos.
npm run check         # Compila y verifica tipos de helpers del container, Worker y UI.
npm test              # Ejecuta la suite de pruebas automatizada.
npm run build         # Construye la interfaz web.
```

Comandos de desarrollo:

```sh
npm run dev           # Compila la interfaz e inicia el Worker local.
npm run dev:ui        # Vite con recarga automática; requiere el Worker local en :8787.
npm run preview:editor # Interfaz con datos simulados en :8795, sin claves ni red externa.
```

Verifica la construcción de Docker y el aislamiento del contenedor:

```sh
npx wrangler deploy --dry-run --outdir dist
docker build --platform linux/amd64 -t cf-sandbox-coding:local .
```

## Pruebas

Ejecuta `npm run check` y `npm test` antes de enviar cualquier cambio. Agrega pruebas cuando cubran una corrección real de errores o un nuevo comportamiento significativo. La suite automatizada cubre rutas, eventos SSE, enlaces de PR, activos estáticos bajo CSP y más.

Las vistas previas simuladas (`npm run preview:editor`) ejercitan estados de UI, navegación, borradores y flujos de guardado sin ejecutar tareas reales de agentes ni contactar APIs externas. No reemplazan la verificación contra un entorno desplegado.

## Pull requests

Los PRs creados por el agente son **borradores**. Al revisar PRs enviados manualmente:

- Asegúrate de que cada cambio aborde una tarea bien definida.
- Verifica que `npm run check` y `npm test` pasen.
- Confirma que no haya secretos, credenciales ni datos sensibles presentes.
- Revisa que las diferencias incluyan archivos binarios, eliminaciones, renombres, actualizaciones de symlinks y cambios de permisos cuando corresponda.
- Valida que el título y la descripción del PR describan los cambios y las pruebas realizadas.

El botón "Crear PR" del Runner crea un commit sobre el SHA inicial, una rama `sandbox/ID-TAREA` y un PR borrador hacia la rama origen. Los reintentos reutilizan la rama y el PR; nunca se sobrescribe una rama con contenido diferente. No hay fusiones ni despliegues automáticos.

## Gestión del árbol de workspaces

- Un subagente nunca elimina su propio worktree; informa su ruta al agente principal.
- Si el agente principal está dentro de un worktree, pide confirmación antes de eliminarlo.
- Desde la raíz del repositorio, el agente principal solo puede limpiar worktrees que él mismo creó.

## Qué buscamos

- Correcciones de errores y cobertura de casos límite.
- Mejoras en pruebas, manejo de errores y observabilidad.
- Limpiezas y refactorizaciones que mejoren la mantenibilidad sin cambiar el comportamiento.
- Mejoras en la documentación.
- Dependencias preparadas en la imagen de Docker para que los agentes puedan verificar el proyecto dentro del sandbox.

## Reportar problemas

Describe el problema, pasos para reproducirlo, resultados esperados vs. reales y registros o capturas de pantalla relevantes. Si el problema involucra credenciales, entornos o configuraciones específicas del agente, menciona esos detalles sin exponer ningún valor secreto.
