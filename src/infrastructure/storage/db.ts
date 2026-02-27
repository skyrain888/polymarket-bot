import { Database } from 'bun:sqlite'
import { SCHEMA } from './schema.ts'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function createDb(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec(SCHEMA)
  return db
}
