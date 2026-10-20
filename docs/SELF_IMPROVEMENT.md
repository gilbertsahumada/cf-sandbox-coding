# Mejorar el runner con sus propios agentes

Repositorio: https://github.com/gilbertsahumada/cf-sandbox-coding

## Ciclo de trabajo

1. Autoriza este repositorio en la GitHub App del runner cuando la conexión esté funcionando.
2. En la interfaz elige este repositorio, Pi u OpenCode y una tarea acotada.
3. El agente trabaja sobre un clon aislado y devuelve sus logs, explicación y patch.
4. Revisa el patch y aplícalo en una rama del repositorio. Ejecuta las comprobaciones y abre un pull request.
5. Incorpora los cambios y despliega después de revisarlos. La siguiente tarea clonará la versión actualizada.

La integración actual tiene permisos de lectura. Todavía no abre pull requests desde la interfaz ni inicia mejoras periódicas. GitHub Actions verifica los commits y pull requests sin credenciales del modelo o de Cloudflare.

## Estado de la conexión GitHub

Se corrigieron dos fallos: Cloudflare rechaza redirect: error, y la comprobación de permisos consumía el cuerpo POST de Git antes de enviarlo. El registro, el catálogo y una clonación privada ya están verificados en Cloudflare. Las tareas con Pi y OpenCode contra repositorios públicos se probaron anteriormente; esta comprobación privada solo clonó el repositorio y no envió su código al modelo.

Tarea de mejora sugerida:

> Investiga el flujo de conexión GitHub desde el botón de la interfaz hasta los callbacks de manifiesto e instalación. Reproduce el fallo con pruebas que cubran el intercambio realista de respuestas y los errores del Durable Object. Corrige la causa demostrada, conserva la validación de estado y cookies, y muestra errores útiles sin revelar credenciales. Ejecuta npm run check y npm test. Entrega el diff e indica qué requiere todavía verificación en GitHub real. No hagas commit ni despliegues.

## Siguientes mejoras candidatas

- Exportar una propuesta revisable a una rama y un pull request con permisos explícitos y mínimos.
- Preparar dependencias de prueba en la imagen para que el agente pueda verificar este proyecto dentro del sandbox.
- Limpiar resultados antiguos de forma configurable.

No actives un bucle de ejecución continua sin definir primero una tarea, un presupuesto y una condición de parada.
