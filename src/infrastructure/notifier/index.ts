import type { NotifyEvent, NotifyChannel } from './types.ts'
import { TelegramNotifier } from './telegram.ts'
import { DiscordNotifier } from './discord.ts'

export class Notifier {
  private channels: NotifyChannel[] = []

  constructor(config: {
    telegram: { token: string; chatId: string } | null
    discord: { webhookUrl: string } | null
  }) {
    if (config.telegram) this.channels.push(new TelegramNotifier(config.telegram))
    if (config.discord) this.channels.push(new DiscordNotifier(config.discord))
  }

  async send(event: NotifyEvent): Promise<void> {
    await Promise.allSettled(this.channels.map(c => c.send(event)))
  }

  async info(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'info', type, message })
  }

  async warning(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'warning', type, message })
  }

  async critical(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'critical', type, message })
  }
}
