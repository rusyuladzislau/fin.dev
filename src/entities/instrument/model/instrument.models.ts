export interface MarketUpdate {
  instrument: string;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}

export interface InstrumentMetricState {
  instrument: string;
  lastPriceCents: number | null;
  volume: number;
  volumeWeightedPriceTotal: number;
  latestBidCents: number | null;
  latestAskCents: number | null;
  latestBidQuantity: number | null;
  latestAskQuantity: number | null;
}

export interface InstrumentMetrics {
  instrument: string;
  lastPriceCents: number | null;
  spreadCents: number | null;
  volume: number;
  vwapCents: number | null;
  imbalance: number | null;
}
