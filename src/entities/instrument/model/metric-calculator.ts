import { InstrumentMetricState, InstrumentMetrics, MarketUpdate } from './instrument.models';

export class MetricCalculator {
  private readonly states = new Map<string, InstrumentMetricState>();

  reset(instruments: readonly string[]): void {
    this.states.clear();
    for (const instrument of instruments) {
      this.states.set(instrument, {
        instrument,
        lastPriceCents: null,
        volume: 0,
        volumeWeightedPriceTotal: 0,
        latestBidCents: null,
        latestAskCents: null,
        latestBidQuantity: null,
        latestAskQuantity: null,
      });
    }
  }

  apply(update: MarketUpdate): void {
    const state = this.states.get(update.instrument);
    if (!state) {
      throw new Error(`Unknown instrument: ${update.instrument}`);
    }

    state.lastPriceCents = update.priceCents;
    state.volume += update.tradeQuantity;
    state.volumeWeightedPriceTotal += update.priceCents * update.tradeQuantity;
    state.latestBidCents = update.bidCents;
    state.latestAskCents = update.askCents;
    state.latestBidQuantity = update.bidQuantity;
    state.latestAskQuantity = update.askQuantity;
  }

  getSnapshot(): InstrumentMetrics[] {
    return Array.from(this.states.values(), (state) => {
      const hasBook =
        state.latestBidCents !== null &&
        state.latestAskCents !== null &&
        state.latestBidQuantity !== null &&
        state.latestAskQuantity !== null;
      const bookQuantity = hasBook ? state.latestBidQuantity! + state.latestAskQuantity! : 0;

      return {
        instrument: state.instrument,
        lastPriceCents: state.lastPriceCents,
        spreadCents: hasBook ? state.latestAskCents! - state.latestBidCents! : null,
        volume: state.volume,
        vwapCents: state.volume === 0 ? null : state.volumeWeightedPriceTotal / state.volume,
        imbalance:
          hasBook && bookQuantity !== 0
            ? (state.latestBidQuantity! - state.latestAskQuantity!) / bookQuantity
            : null,
      };
    });
  }
}
