import { describe, test, expect, mock } from 'bun:test'
import { EventBus } from '../../src/core/event-bus.ts'

describe('EventBus', () => {
  test('emits events to subscribers', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('trade:executed', handler)
    bus.emit('trade:executed', { marketId: 'x', side: 'buy' })
    expect(handler).toHaveBeenCalledWith({ marketId: 'x', side: 'buy' })
  })

  test('off() unsubscribes handler', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('trade:executed', handler)
    bus.off('trade:executed', handler)
    bus.emit('trade:executed', {})
    expect(handler).not.toHaveBeenCalled()
  })

  test('once() fires only one time', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.once('risk:breach', handler)
    bus.emit('risk:breach', {})
    bus.emit('risk:breach', {})
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
