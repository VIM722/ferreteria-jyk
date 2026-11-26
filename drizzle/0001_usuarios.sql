CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('vendedor','almacenero','dueno','administrador')),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  sal TEXT NOT NULL,
  clave_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  identidad TEXT NOT NULL,
  revision INTEGER NOT NULL,
  vence INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sesiones_vence ON sesiones(vence);
--> statement-breakpoint
CREATE TABLE intentos_login (
  clave TEXT NOT NULL,
  ventana INTEGER NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (clave, ventana)
);
--> statement-breakpoint
CREATE TABLE actividad (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  accion TEXT NOT NULL,
  detalle TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE ventas ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
--> statement-breakpoint
CREATE INDEX ventas_usuario_fecha ON ventas(usuario_id, fecha);
--> statement-breakpoint
CREATE TRIGGER conservar_administrador BEFORE UPDATE OF rol, activo ON usuarios
WHEN OLD.rol = 'administrador' AND OLD.activo = 1 AND (NEW.rol <> 'administrador' OR NEW.activo = 0)
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id <> OLD.id AND rol = 'administrador' AND activo = 1)
BEGIN
  SELECT RAISE(ABORT, 'ultimo_administrador');
END;
