# Ferretería JyK

Aplicación web de ventas e inventario. La primera versión usa HTML, CSS y JavaScript, una API en un Cloudflare Worker y una base SQL compartida. En desarrollo se ejecuta con el módulo SQLite integrado de Node.js.

## Ejecutar en local

Con Node.js 24 o posterior, desde la raíz del proyecto:

```sh
npm run dev
```

Abre [http://localhost:8080](http://localhost:8080). Los registros se guardan en `.data/ferreteria.sqlite` entre ejecuciones. La aplicación carga un catálogo, tres proveedores y ventas ficticias al inicializar una base nueva.

## Inicio de sesión y roles

El sistema crea las cuentas iniciales `vendedor`, `almacenero`, `dueno` y `admin`, además de `ventas2` y `almacen2`. Las claves de prueba se entregan al titular del proyecto. Cualquier persona con el enlace puede abrir el formulario de ingreso. Las operaciones y los datos requieren una cuenta de Ferretería JyK con el rol correspondiente.

| Rol | Acceso |
| --- | --- |
| Vendedor | Caja, disponibilidad y precio de venta, comprobantes e historial de sus propias ventas. |
| Almacenero | Existencias, alertas, ingresos y bajas, y consulta de movimientos. Puede seleccionar un proveedor al registrar un ingreso. |
| Dueño | Panel, rentabilidad y rotación, administración de productos y proveedores, consulta de existencias y asistente. |
| Administrador | Todos los módulos, historial completo, administración de cuentas y registro de actividad. |

Desde **Usuarios**, el administrador puede crear y editar cuentas, asignar roles, restablecer contraseñas y desactivar o reactivar cuentas. Un cambio de rol, usuario, contraseña o estado invalida las sesiones anteriores de esa cuenta. Las contraseñas se almacenan como hashes con una sal individual. Las ventas históricas de demostración se asignan a `vendedor`. Las ventas anteriores sin cuenta asociada siguen disponibles para el administrador.

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
| RF-19 a RF-21 | Acceso administrativo completo, gestión de usuarios y roles, y registro de actividad. |
| RF-14 | Asistente conversacional basado en reglas para ventas, reposición y promociones. |

## Asistente de recomendaciones

El asistente de Dueño y Administrador ejecuta consultas sobre la misma base que Ventas e Inventario. Funciona con reglas locales, sin API de IA, clave ni cobro por consulta. Las preguntas admiten temas de ventas, reposición y promociones. Se puede seleccionar el periodo y el horizonte de compra o indicarlos en la pregunta.

- Los más vendidos se ordenan por unidades. Los ingresos reflejan los descuentos aplicados.
- Para reponer, se proyecta el promedio diario al horizonte elegido. La compra sugerida cubre esa demanda y el mínimo de reserva después de descontar las existencias actuales.
- Las promociones usan pares presentes en al menos dos comprobantes. El combo aplica un descuento de hasta 5 % cuando ambos productos tienen stock por encima del mínimo y el costo registrado deja margen. El chat propone precios y no los cambia.
- El catálogo inicial añade 22 referencias de ferretería. Si todavía solo hay ventas de demostración, se agregan canastas de ejemplo y el chat las identifica como datos de demostración. Cuando existe actividad operativa, el chat usa esas ventas y el catálogo ampliado se incorpora con stock cero.

El comprobante queda identificado como interno. La emisión tributaria electrónica y otras integraciones se pueden definir en una fase posterior. El prototipo incluye datos ficticios para recorrer los flujos desde el primer acceso.

Las ventas y sus partidas se escriben en una transacción. Los movimientos mantienen el stock y su historial, y la base rechaza los saldos negativos. El historial conserva el nombre, el precio, el costo y el descuento aplicados al momento de la venta.

## Despliegue

La aplicación está desplegada en [Ferretería JyK](https://ferreteria-jyk.drawngate6.chatgpt.site/) y usa Cloudflare D1 mediante el enlace `DB`. El ingreso usa las credenciales propias de la ferretería. El build genera `dist/server/index.js`. Las migraciones numeradas de `drizzle/` definen el esquema. SQLite y D1 usan bases de datos independientes.

La disponibilidad continua, el objetivo de rendimiento bajo carga y los respaldos automáticos siguen pendientes de validación o implementación.
