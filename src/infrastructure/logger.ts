import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

const LOG_PATH = './data/bot.log'

// Ensure log directory exists
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
