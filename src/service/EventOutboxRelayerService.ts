import crypto from 'node:crypto';
import type { CloudEvent } from '../domain/events.js';

export interface OutboxEntry {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, any>;
  status: 'PENDING' | 'DISPATCHED' | 'FAILED';
  retryCount: number;
  createdAt: string;
  dispatchedAt?: string;
  lastError?: string;
}

export interface KafkaProducerLike {
  send(topic: string, message: { key: string; value: string }): Promise<void>;
}

export class EventOutboxRelayerService {
  private outboxQueue = new Map<string, OutboxEntry>();
  private readonly MAX_RETRIES = 5;

  public enqueueEvent(params: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, any>;
  }): OutboxEntry {
    const id = `out_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const entry: OutboxEntry = {
      id,
      eventType: params.eventType,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      payload: params.payload,
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.outboxQueue.set(id, entry);
    return entry;
  }

  public async relayPendingEvents(producer: KafkaProducerLike): Promise<{ dispatched: number; failed: number }> {
    let dispatched = 0;
    let failed = 0;

    for (const entry of this.outboxQueue.values()) {
      if (entry.status === 'DISPATCHED') continue;

      try {
        const topic = `oenexa.${entry.aggregateType.toLowerCase()}.${entry.eventType.toLowerCase()}`;
        const messageValue = JSON.stringify({
          eventId: entry.id,
          eventType: entry.eventType,
          aggregateId: entry.aggregateId,
          timestamp: new Date().toISOString(),
          data: entry.payload,
        });

        await producer.send(topic, {
          key: entry.aggregateId,
          value: messageValue,
        });

        entry.status = 'DISPATCHED';
        entry.dispatchedAt = new Date().toISOString();
        dispatched++;
      } catch (err: any) {
        entry.retryCount++;
        entry.lastError = err.message || 'Kafka dispatch failure';
        if (entry.retryCount >= this.MAX_RETRIES) {
          entry.status = 'FAILED';
        }
        failed++;
      }
    }

    return { dispatched, failed };
  }

  public getPendingCount(): number {
    return Array.from(this.outboxQueue.values()).filter((e) => e.status === 'PENDING').length;
  }

  public getEntry(id: string): OutboxEntry | undefined {
    return this.outboxQueue.get(id);
  }
}
