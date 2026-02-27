import type { NotifyChannel, NotifyEvent } from './types.ts'

const COLOR = { info: 0x3498db, warning: 0xf39c12, critical: 0xe74c3c }

export class DiscordNotifier implements NotifyChannel {
  constructor(private config: { webhookUrl: string }) {}

  async send(event: NotifyEvent): Promise<void> {
    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: event.type.toUpperCase(),
          description: event.message,
          color: COLOR[event.level],
          timestamp: new Date().toISOString(),
        }],
      }),
    }).catch(err => console.error('Discord send failed:', err))
  }
}
