CREATE TABLE configuracion (clave TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE productos (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio INTEGER NOT NULL CHECK (precio > 0),
  costo INTEGER NOT NULL CHECK (costo >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  minimo INTEGER NOT NULL CHECK (minimo >= 0)
);
--> statement-breakpoint
CREATE TABLE proveedores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contacto TEXT NOT NULL,
  correo TEXT NOT NULL,
  telefono TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE producto_proveedor (
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  PRIMARY KEY (producto_id, proveedor_id)
);
--> statement-breakpoint
CREATE TABLE ventas (
  id INTEGER PRIMARY KEY,
  solicitud TEXT NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  cliente TEXT NOT NULL,
  documento TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Boleta','Factura')),
  pago TEXT NOT NULL CHECK (pago IN ('Efectivo','Tarjeta','Yape / Plin','Transferencia')),
  total INTEGER NOT NULL DEFAULT 0,
  costo INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE partidas (
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio INTEGER NOT NULL CHECK (precio > 0),
  costo INTEGER NOT NULL CHECK (costo >= 0),
  descuento INTEGER NOT NULL CHECK (descuento BETWEEN 0 AND precio * cantidad),
  PRIMARY KEY (venta_id, producto_id)
);
--> statement-breakpoint
CREATE TABLE movimientos (
  id INTEGER PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  venta_id INTEGER REFERENCES ventas(id),
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Inicial','Ingreso','Baja','Venta')),
  cantidad INTEGER NOT NULL CHECK (cantidad != 0),
  costo INTEGER CHECK (costo >= 0),
  motivo TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ventas_fecha ON ventas(fecha);
--> statement-breakpoint
CREATE INDEX partidas_producto ON partidas(producto_id);
--> statement-breakpoint
CREATE INDEX movimientos_producto ON movimientos(producto_id, fecha);
--> statement-breakpoint
CREATE TRIGGER aplicar_movimiento AFTER INSERT ON movimientos
BEGIN
  SELECT CASE WHEN (SELECT stock FROM productos WHERE id = NEW.producto_id) + NEW.cantidad < 0
    THEN RAISE(ABORT, 'stock_insuficiente') END;
  UPDATE productos SET
    costo = CASE WHEN NEW.tipo = 'Ingreso' THEN
      CAST(round(1.0 * (costo * stock + NEW.costo * NEW.cantidad) / (stock + NEW.cantidad)) AS INTEGER)
      ELSE costo END,
    stock = stock + NEW.cantidad
  WHERE id = NEW.producto_id;
END;
--> statement-breakpoint
CREATE TRIGGER aplicar_partida AFTER INSERT ON partidas
BEGIN
  INSERT INTO movimientos(producto_id, venta_id, fecha, tipo, cantidad, motivo)
    SELECT NEW.producto_id, id, fecha, 'Venta', -NEW.cantidad, 'Venta registrada'
    FROM ventas WHERE id = NEW.venta_id;
  UPDATE ventas SET total = total + NEW.precio * NEW.cantidad - NEW.descuento,
    costo = costo + NEW.costo * NEW.cantidad WHERE id = NEW.venta_id;
END;
