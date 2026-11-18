use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketUpdate {
    pub instrument: String,
    pub price_cents: i64,
    pub trade_quantity: i64,
    pub bid_cents: i64,
    pub ask_cents: i64,
    pub bid_quantity: i64,
    pub ask_quantity: i64,
}

#[derive(Debug, Clone)]
pub struct InstrumentState {
    pub symbol: String,
    pub reference_price_cents: i64,
}
