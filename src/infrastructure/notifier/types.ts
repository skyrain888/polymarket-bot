export type NotifyLevel = 'info' | 'warning' | 'critical'
export type NotifyEventType =
  | 'trade_executed'
  | 'trade_rejected'
  | 'circuit_breaker'
  | 'daily_loss_limit'
  | 'llm_alert'
  | 'system'

export interface NotifyEvent {
  level: NotifyLevel
  type: NotifyEventType
  message: string
  metadata?: Record<string, unknown>
}

export interface NotifyChannel {
  send(event: NotifyEvent): Promise<void>
}
