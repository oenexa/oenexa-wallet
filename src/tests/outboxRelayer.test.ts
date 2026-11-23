import { describe, it, expect, beforeEach } from 'vitest';
import { EventOutboxRelayerService, type KafkaProducerLike } from '../service/EventOutboxRelayerService.js';

describe('EventOutboxRelayerService Transactional Outbox Pattern', () => {
  let relayer: EventOutboxRelayerService;
  let mockProducer: KafkaProducerLike;
  let sentMessages: { topic: string; message: any }[];

  beforeEach(() => {
    relayer = new EventOutboxRelayerService();
    sentMessages = [];
    mockProducer = {
      send: async (topic, message) => {
        sentMessages.push({ topic, message });
      },
    };
  });

  it('enqueues domain events as pending outbox records', () => {
    const entry = relayer.enqueueEvent({
      eventType: 'FUNDS_DEPOSITED',
      aggregateType: 'WALLET',
      aggregateId: 'usr_wallet_101',
      payload: { asset: 'BTC', amount: '1.25000000', txHash: '0xabc123' },
    });

    expect(entry.id).toBeDefined();
    expect(entry.status).toBe('PENDING');
    expect(relayer.getPendingCount()).toBe(1);
  });

  it('dispatches pending events to the message broker and updates status to DISPATCHED', async () => {
    const entry = relayer.enqueueEvent({
      eventType: 'WITHDRAWAL_REQUESTED',
      aggregateType: 'WALLET',
      aggregateId: 'usr_wallet_202',
      payload: { asset: 'USDT', amount: '5000.00' },
    });

    const result = await relayer.relayPendingEvents(mockProducer);

    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(0);
    expect(relayer.getPendingCount()).toBe(0);
    expect(relayer.getEntry(entry.id)?.status).toBe('DISPATCHED');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].topic).toBe('oenexa.wallet.withdrawal_requested');
  });

  it('retries failing dispatches and transitions to FAILED when max retries exceeded', async () => {
    const failingProducer: KafkaProducerLike = {
      send: async () => {
        throw new Error('Broker connection timeout');
      },
    };

    const entry = relayer.enqueueEvent({
      eventType: 'MPC_SWEEP_EXECUTED',
      aggregateType: 'CUSTODY',
      aggregateId: 'vault_hot_01',
      payload: { amount: '25.0' },
    });

    // Execute 5 retry attempts
    for (let i = 0; i < 5; i++) {
      await relayer.relayPendingEvents(failingProducer);
    }

    const updated = relayer.getEntry(entry.id);
    expect(updated?.status).toBe('FAILED');
    expect(updated?.retryCount).toBe(5);
    expect(updated?.lastError).toContain('Broker connection timeout');
  });
});
