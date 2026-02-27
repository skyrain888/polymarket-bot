import type { NotifyChannel, NotifyEvent } from './types.ts'

const EMOJI = { info: 'ℹ️', warning: '⚠️', critical: '🚨' }

export class TelegramNotifier implements NotifyChannel {
  constructor(private config: { token: string; chatId: string }) {}

  async send(event: NotifyEvent): Promise<void> {
    const emoji = EMOJI[event.level]
    const text = `${emoji} *[${event.type.toUpperCase()}]*\n${event.message}`
    const url = `https://api.telegram.org/bot${this.config.token}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.config.chatId, text, parse_mode: 'Markdown' }),
    }).catch(err => console.error('Telegram send failed:', err))
  }
}
