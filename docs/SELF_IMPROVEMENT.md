# Mejorar el runner con sus propios agentes

Repositorio: https://github.com/gilbertsahumada/cf-sandbox-coding

## Ciclo de trabajo

1. Autoriza este repositorio en la GitHub App del runner cuando la conexión esté funcionando.
2. En la interfaz elige este repositorio, Pi u OpenCode y una tarea acotada.
3. El agente trabaja sobre un clon aislado y devuelve sus logs, explicación y patch.
4. Revisa el patch y aplícalo en una rama del repositorio. Ejecuta las comprobaciones y abre un pull request.
5. Incorpora los cambios y despliega después de revisarlos. La siguiente tarea clonará la versión actualizada.

La integración actual tiene permisos de lectura. Todavía no abre pull requests desde la interfaz ni inicia mejoras periódicas. GitHub Actions verifica los commits y pull requests sin credenciales del modelo o de Cloudflare.

## Primera tarea: verificar la conexión GitHub

Se identificó que Cloudflare rechaza redirect: error y se corrigió a redirect: manual, manteniendo bloqueadas las redirecciones. La integración real aún no está validada; no debe marcarse como completada por pasar las pruebas unitarias.

Prompt sugerido:

> Investiga el flujo de conexión GitHub desde el botón de la interfaz hasta los callbacks de manifiesto e instalación. Reproduce el fallo con pruebas que cubran el intercambio realista de respuestas y los errores del Durable Object. Corrige la causa demostrada, conserva la validación de estado y cookies, y muestra errores útiles sin revelar credenciales. Ejecuta npm run check y npm test. Entrega el diff e indica qué requiere todavía verificación en GitHub real. No hagas commit ni despliegues.

## Siguientes mejoras candidatas

- Exportar una propuesta revisable a una rama y un pull request con permisos explícitos y mínimos.
- Preparar dependencias de prueba en la imagen para que el agente pueda verificar este proyecto dentro del sandbox.
- Limpiar resultados antiguos de forma configurable.

No actives un bucle de ejecución continua sin definir primero una tarea, un presupuesto y una condición de parada.
