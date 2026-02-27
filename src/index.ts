import { startBot } from './bot.ts'

startBot().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
