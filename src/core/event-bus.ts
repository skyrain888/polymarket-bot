export type EventMap = {
  'trade:intent':    { strategyId: string; marketId: string; side: 'buy' | 'sell'; size: number; price: number }
  'trade:executed':  { orderId: string; marketId: string; side: string; size: number; price: number }
  'trade:rejected':  { reason: string; strategyId: string; marketId: string }
  'risk:breach':     { type: string; strategyId?: string; message: string }
  'circuit:tripped': { strategyId: string; reason: string }
  'circuit:reset':   { strategyId: string }
  'signal:ready':    { marketId: string }
  'position:updated':{ marketId: string }
  [key: string]: unknown
}

type Handler<T = unknown> = (payload: T) => void

export class EventBus {
  private listeners = new Map<string, Set<Handler>>()

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set())
    }
    this.listeners.get(event as string)!.add(handler as Handler)
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event as string)?.delete(handler as Handler)
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    const wrapper: Handler = (payload) => {
      handler(payload as EventMap[K])
      this.off(event, wrapper as Handler<EventMap[K]>)
    }
    this.on(event, wrapper as Handler<EventMap[K]>)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners.get(event as string)?.forEach(h => h(payload))
  }
}
