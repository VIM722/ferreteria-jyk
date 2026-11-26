import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

export function database(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS migraciones(archivo TEXT PRIMARY KEY)')
  function transaction(run) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const folder = new URL('../drizzle/', import.meta.url)
  for (const filename of readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
    transaction(() => {
      if (!db.prepare('SELECT archivo FROM migraciones WHERE archivo=?').get(filename)) {
        db.exec(readFileSync(new URL(filename, folder), 'utf8'))
        db.prepare('INSERT INTO migraciones VALUES (?)').run(filename)
      }
    })
  }
  function statement(sql, args = []) {
    return {
      bind: (...next) => statement(sql, next),
      first: () => db.prepare(sql).get(...args) ?? null,
      all: () => ({ results: db.prepare(sql).all(...args) }),
      run: () => db.prepare(sql).run(...args),
      execute: () => /^\s*(?:SELECT|WITH)\b/i.test(sql) ? { results: db.prepare(sql).all(...args) } : { results: [], meta: db.prepare(sql).run(...args) },
    }
  }
  return { prepare: statement, batch: queries => transaction(() => queries.map(query => query.execute())), close: () => db.close() }
}
