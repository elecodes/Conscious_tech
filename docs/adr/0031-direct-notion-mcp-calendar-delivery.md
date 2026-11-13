# ADR 0031 — Conectar una cuenta y enviar el calendario a Notion

Fecha: 2026-11-13
Estado: Implementado para la vista de prueba local; pendiente validación con cuenta real

## Contexto y alcance

La persona solicita conectar su cuenta desde Conscious Tech y enviar el calendario sin importar CSV. Se utiliza el MCP alojado oficial de Notion. La exportación CSV de ADR 0030 continúa disponible.

## Decisión

- Flujo explícito: Conectar Notion → autorización en ventana de Notion → revisar entradas y destino privado → confirmar envío → abrir la copia.
- OAuth Authorization Code con PKCE S256, state de un solo uso ligado a cookie HttpOnly y vencimiento de diez minutos; validar issuer en metadatos y callback. Registro dinámico público por origen, sin pedir claves al usuario.
- Servidor Node/Vite local: tokens únicamente en un almacén AES-256-GCM, directorio 0700 y archivos 0600. La clave local también está protegida por permisos. Cookie de sesión de siete días, separada por origen/puerto, SameSite=Lax, Secure con HTTPS. Nunca exportar credenciales al cuaderno ni a sus copias JSON.
- Origen fijo `NOTION_APP_ORIGIN` (por defecto `http://localhost:5181`); verificar Host y Origin en mutaciones. No aceptar URLs de servidor MCP proporcionadas por el navegador. Solo contactar `https://mcp.notion.com`; sin redirecciones HTTP automáticas.
- Adaptador acotado al protocolo MCP 2026-07-28 documentado por Notion: peticiones autocontenidas, JSON/SSE, cabeceras de protocolo/método/nombre y parámetros anotados. No es un cliente MCP genérico, no ejecuta instrucciones remotas, sampling ni elicitation.
- Reutilizar la proyección del exportador CSV; enviar únicamente nombres, fechas, estados, horas y metadatos de las entradas, sin notas originales. Convertir las fechas del CSV a ISO para propiedades Notion. Una fila por reparto/bloque, pendientes sin fecha en tabla, fecha límite separada.
- Comprobar herramientas disponibles antes de escribir; crear una base privada nueva, consultarla, añadir vista Calendario sobre `Fecha` y escribir lotes de hasta diez entradas. Límite inicial: 300 entradas / 256 KiB por envío.
- No sincronizar ni modificar bases existentes. El mismo contenido en esta conexión reutiliza el resultado persistido; una nueva autorización reinicia los marcadores para no reutilizar resultados de otra cuenta; un contenido distinto crea otra copia y la interfaz lo explica antes de confirmar.
- Persistir un marcador antes de las escrituras. Ante respuesta perdida, error o interrupción, conservar el estado y enlace conocidos; no repetir escrituras automáticamente ni afirmar que se ha completado. No borrar copias parciales de forma automática.
- Desconectar elimina credenciales de esta sesión local. Las copias permanecen en Notion. La revocación del permiso se gestiona también desde los ajustes de Notion.

## Límites operativos

Este almacén está pensado para un único proceso local, no para varias réplicas ni para publicar un servicio multiusuario. Un despliegue público necesita un backend mantenido, identidad/sesiones, almacenamiento y gestión de claves de producción, control de concurrencia distribuido y revisión del flujo OAuth. Un hosting estático de `dist` no ofrece estas rutas; desarrollo y preview sí las montan.

Cerrar el navegador conserva la sesión mientras permanezcan cookie y archivos locales. Reiniciar el servidor conserva la conexión y los marcadores. Borrar `.notion-local`, cambiar el origen o transcurrir siete días requiere volver a conectar. La carpeta y la clave no deben publicarse, compartirse ni añadirse a Git.

Los permisos disponibles dependen del workspace, la cuenta y las herramientas expuestas por Notion. La conexión no reduce por sí sola los permisos que Notion muestre en su autorización. Si faltan herramientas, se detiene antes de crear la base. Si el contrato remoto cambia o una escritura queda incierta, se muestra el resultado incompleto.

## Verificación

Pruebas de integración HTTP con proveedor simulado: PKCE, state/cookie/issuer, replay, renovación, cifrado y reinicio, aislamiento, errores parciales y ausencia de repetición. Prueba de interfaz en Chromium con OAuth y respuestas simuladas, más recorrido general de la aplicación. La consulta real de metadatos oficiales se verificó; no se ha autorizado una cuenta ni escrito en un workspace real durante el desarrollo.

Referencias: [Cliente MCP para Notion](https://developers.notion.com/guides/mcp/build-mcp-client), [Herramientas](https://developers.notion.com/guides/mcp/mcp-supported-tools), [Streamable HTTP 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx).
