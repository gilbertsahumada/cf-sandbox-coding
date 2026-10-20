# Mejorar el runner con sus propios agentes

Repositorio: https://github.com/gilbertsahumada/cf-sandbox-coding

## Ciclo de trabajo

1. Autoriza este repositorio en la GitHub App del runner cuando la conexión esté funcionando.
2. En la interfaz elige este repositorio, Pi u OpenCode y una tarea acotada.
3. El agente trabaja sobre un clon aislado. Responde en el chat de esa tarea para continuar con su contexto y cambios. Los logs y el patch se actualizan en cada turno.
4. Revisa los cambios y pulsa **Crear PR** para publicar una rama y un borrador desde el Worker. Describe las pruebas realizadas; ejecuta las comprobaciones antes de incorporar la propuesta.
5. Incorpora los cambios y despliega después de revisarlos. La siguiente tarea clonará la versión actualizada.

La clonación y la red del agente mantienen permisos de lectura. El botón **Crear PR** requiere aprobar Contents y Pull requests en Read and write en la GitHub App; solo el Worker recibe un token de escritura limitado al repositorio seleccionado. No hay mejoras periódicas. GitHub Actions verifica los commits y pull requests sin credenciales del modelo o de Cloudflare.

## Estado de la conexión GitHub

Se corrigieron dos fallos: Cloudflare rechaza redirect: error, y la comprobación de permisos consumía el cuerpo POST de Git antes de enviarlo. El registro, el catálogo y una clonación privada ya están verificados en Cloudflare. Las tareas con Pi y OpenCode contra repositorios públicos se probaron anteriormente; esta comprobación privada solo clonó el repositorio y no envió su código al modelo.

Tarea de mejora sugerida:

> Investiga el flujo de conexión GitHub desde el botón de la interfaz hasta los callbacks de manifiesto e instalación. Reproduce el fallo con pruebas que cubran el intercambio realista de respuestas y los errores del Durable Object. Corrige la causa demostrada, conserva la validación de estado y cookies, y muestra errores útiles sin revelar credenciales. Ejecuta npm run check y npm test. Entrega el diff e indica qué requiere todavía verificación en GitHub real. No hagas commit ni despliegues.

## Siguientes mejoras candidatas

- Preparar dependencias de prueba en la imagen para que el agente pueda verificar este proyecto dentro del sandbox.
- Limpiar resultados antiguos de forma configurable.

No actives un bucle de ejecución continua sin definir primero una tarea, un presupuesto y una condición de parada.


## Manual edits in a cloud session

Use Files to inspect the cloned repository and Code to edit existing text files. Save after the agent stops, then send your next instruction in the same task. The runner updates its cumulative diff and recovery checkpoint and tells the native agent which files you edited. Review Changes before using Create PR. A conflict preserves the local draft; reload only after deciding to discard it. Unsaved browser drafts are not durable, and sessions with no current recovery checkpoint cannot restore their files after the container expires.
