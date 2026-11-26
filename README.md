# Ferretería JyK

Aplicación web de ventas e inventario. La primera versión usa HTML, CSS y JavaScript, una API en un Cloudflare Worker y una base SQL compartida. En desarrollo se ejecuta con el módulo SQLite integrado de Node.js.

## Ejecutar en local

Con Node.js 24 o posterior, desde la raíz del proyecto:

```sh
npm run dev
```

Abre [http://localhost:8080](http://localhost:8080). Los registros se guardan en `.data/ferreteria.sqlite` entre ejecuciones. La aplicación carga un catálogo, tres proveedores y ventas ficticias al inicializar una base nueva.

```sh
npm test
npm run build
```

## Primera versión

| Requisitos del PDF | Entrega |
| --- | --- |
| RF-01 a RF-07 | Carrito, consulta de stock, descuento por partida, pago, historial y comprobante interno imprimible. El catálogo fija el precio unitario. |
| RF-08 a RF-11 | Ingresos con costo y proveedor, bajas con motivo, actualización de stock y alertas de mínimos. |
| RF-12 y RF-13 | Indicadores, utilidad bruta estimada según el costo promedio registrado, tendencia y rotación de productos por periodo. |
| RF-15 a RF-18 | Alta y edición de productos y proveedores, con asignación de varios proveedores por producto. |
| RF-14 y RF-19 a RF-21 | Pendientes el agente de IA, la administración de cuentas, los permisos por rol y la auditoría administrativa. |

El comprobante queda identificado como interno. La emisión tributaria electrónica y otras integraciones se pueden definir en una fase posterior. El prototipo incluye datos ficticios para recorrer los flujos desde el primer acceso.

Las ventas y sus partidas se escriben en una transacción. Los movimientos mantienen el stock y su historial, y la base rechaza los saldos negativos. El historial conserva el nombre, el precio, el costo y el descuento aplicados al momento de la venta.

## Despliegue

El destino configurado es un Site privado con autenticación de ChatGPT y enlace a Cloudflare D1 bajo el nombre `DB`. El build genera `dist/server/index.js`. Las migraciones de `drizzle/` definen el esquema. SQLite y D1 usan bases de datos independientes.

La disponibilidad continua, el objetivo de rendimiento bajo carga, los respaldos automáticos y los permisos diferenciados requieren puesta a punto antes de incorporar datos reales.
