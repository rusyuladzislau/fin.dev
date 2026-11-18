import { beforeEach, describe, expect, it } from 'vitest';
import { MetricCalculator } from './metric-calculator';
import { MarketUpdate } from './instrument.models';

function update(overrides: Partial<MarketUpdate> = {}): MarketUpdate {
  return {
    instrument: 'ALFA',
    priceCents: 10_200,
    tradeQuantity: 30,
    bidCents: 10_196,
    askCents: 10_200,
    bidQuantity: 600,
    askQuantity: 400,
    ...overrides,
  };
}

describe('MetricCalculator', () => {
  let calculator: MetricCalculator;

  beforeEach(() => {
    calculator = new MetricCalculator();
    calculator.reset(['ALFA', 'BETA']);
  });

  it('returns unavailable values and zero volume before data arrives', () => {
    expect(calculator.getSnapshot()).toEqual([
      {
        instrument: 'ALFA',
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      },
      {
        instrument: 'BETA',
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      },
    ]);
  });

  it('calculates the complete worked example', () => {
    calculator.apply(
      update({
        priceCents: 10_000,
        tradeQuantity: 10,
        bidCents: 9_998,
        askCents: 10_002,
      }),
    );
    calculator.apply(update());
    const [metrics] = calculator.getSnapshot();

    expect(metrics.lastPriceCents).toBe(10_200);
    expect(metrics.volume).toBe(40);
    expect(metrics.vwapCents).toBe(10_150);
    expect(metrics.spreadCents).toBe(4);
    expect(metrics.imbalance).toBe(0.2);
  });

  it('handles a zero book-quantity denominator', () => {
    calculator.apply(update({ bidQuantity: 0, askQuantity: 0 }));
    expect(calculator.getSnapshot()[0].imbalance).toBeNull();
  });

  it('supports negative imbalance', () => {
    calculator.apply(update({ bidQuantity: 200, askQuantity: 600 }));
    expect(calculator.getSnapshot()[0].imbalance).toBe(-0.5);
  });

  it('counts every trade across and within batches without using book quantities', () => {
    const updates = [
      update({ tradeQuantity: 5, priceCents: 10_000, bidQuantity: 900 }),
      update({ tradeQuantity: 15, priceCents: 10_100, askQuantity: 800 }),
      update({ instrument: 'BETA', tradeQuantity: 7, priceCents: 5_000 }),
    ];
    updates.forEach((item) => calculator.apply(item));
    const [alfa, beta] = calculator.getSnapshot();

    expect(alfa.volume).toBe(20);
    expect(alfa.vwapCents).toBe(10_075);
    expect(beta.volume).toBe(7);
    expect(beta.lastPriceCents).toBe(5_000);
  });

  it('isolates accumulators between instruments', () => {
    calculator.apply(update({ tradeQuantity: 10 }));
    calculator.apply(update({ instrument: 'BETA', priceCents: 2_000, tradeQuantity: 3 }));
    const [alfa, beta] = calculator.getSnapshot();

    expect(alfa.volume).toBe(10);
    expect(alfa.vwapCents).toBe(10_200);
    expect(beta.volume).toBe(3);
    expect(beta.vwapCents).toBe(2_000);
  });

  it('clears all values and accumulators on reset', () => {
    calculator.apply(update());
    calculator.reset(['GAMMA']);
    expect(calculator.getSnapshot()).toEqual([
      {
        instrument: 'GAMMA',
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      },
    ]);
  });

  it('rejects updates for unknown instruments', () => {
    expect(() => calculator.apply(update({ instrument: 'UNKNOWN' }))).toThrow(
      'Unknown instrument: UNKNOWN',
    );
  });
});
