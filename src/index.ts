process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import './infrastructure/logger.ts'
import { startBot } from './bot.ts'

startBot().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
