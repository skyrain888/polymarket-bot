import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

const LOG_PATH = './data/bot.log'

const dir = dirname(LOG_PATH)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const origLog = console.log
const origError = console.error
const origWarn = console.warn

function ts() {
  return new Date().toLocaleString()
}

function writeToFile(level: string, args: any[]) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  appendFileSync(LOG_PATH, `[${ts()}] ${level} ${msg}\n`)
}

if (!(console as any).__loggerPatched) {
  (console as any).__loggerPatched = true

  console.log = (...args: any[]) => {
    origLog(...args)
    writeToFile('INFO', args)
  }

  console.error = (...args: any[]) => {
    origError(...args)
    writeToFile('ERROR', args)
  }

  console.warn = (...args: any[]) => {
    origWarn(...args)
    writeToFile('WARN', args)
  }
}

// ── Structured logger with level filtering ────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const currentLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= (LEVEL_ORDER[currentLevel] ?? 1)
}

function fmt(args: any[]): string {
  return args.map(a => (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a)).join(' ')
}

export const logger = {
  debug(tag: string, msg: string, ...rest: any[]): void {
    if (!shouldLog('debug')) return
    const line = `[DEBUG][${tag}] ${msg}${rest.length ? ' ' + fmt(rest) : ''}`
    origLog(line)
    writeToFile('DEBUG', [line])
  },
  info(tag: string, msg: string, ...rest: any[]): void {
    if (!shouldLog('info')) return
    const line = `[${tag}] ${msg}${rest.length ? ' ' + fmt(rest) : ''}`
    origLog(line)
    writeToFile('INFO ', [line])
  },
  warn(tag: string, msg: string, ...rest: any[]): void {
    if (!shouldLog('warn')) return
    const line = `[WARN][${tag}] ${msg}${rest.length ? ' ' + fmt(rest) : ''}`
    origWarn(line)
    writeToFile('WARN ', [line])
  },
  error(tag: string, msg: string, ...rest: any[]): void {
    if (!shouldLog('error')) return
    const line = `[ERROR][${tag}] ${msg}${rest.length ? ' ' + fmt(rest) : ''}`
    origError(line)
    writeToFile('ERROR', [line])
  },
}
