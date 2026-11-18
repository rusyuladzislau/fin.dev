use crate::models::{InstrumentState, MarketUpdate};
use crate::random::RandomSource;

const NAMED_SYMBOLS: [&str; 10] = [
    "ALFA", "BETA", "GAMMA", "DELTA", "OMEGA", "NOVA", "LYRA", "VEGA", "ORION", "ATLAS",
];

#[derive(Debug)]
pub struct MarketGenerator {
    instruments: Vec<InstrumentState>,
    random: RandomSource,
}

impl MarketGenerator {
    pub fn new(instrument_count: usize, seed: u64) -> Result<Self, String> {
        if !(1..=50).contains(&instrument_count) {
            return Err("instrument count must be between 1 and 50".to_owned());
        }

        let mut random = RandomSource::new(seed);
        let instruments = (0..instrument_count)
            .map(|index| InstrumentState {
                symbol: symbol_for(index),
                reference_price_cents: random.range_inclusive(5_000, 50_000),
            })
            .collect();

        Ok(Self { instruments, random })
    }

    pub fn instrument_symbols(&self) -> Vec<String> {
        self.instruments
            .iter()
            .map(|instrument| instrument.symbol.clone())
            .collect()
    }

    pub fn generate_batch(&mut self, batch_size: usize) -> Result<Vec<MarketUpdate>, String> {
        if !(1..=1_000).contains(&batch_size) {
            return Err("batch size must be between 1 and 1,000".to_owned());
        }

        let mut updates = Vec::with_capacity(batch_size);
        for _ in 0..batch_size {
            updates.push(self.next_update());
        }
        Ok(updates)
    }

    fn next_update(&mut self) -> MarketUpdate {
        let instrument_index = self.random.range_inclusive(0, self.instruments.len() as i64 - 1) as usize;
        let max_move = (self.instruments[instrument_index].reference_price_cents / 100).max(1);
        let movement = self.random.range_inclusive(-max_move, max_move);
        let previous_price = self.instruments[instrument_index].reference_price_cents;
        let mid_price = (previous_price + movement).max(100);
        let max_half_spread = (mid_price / 1_000).max(2);
        let half_spread = self.random.range_inclusive(1, max_half_spread);
        let bid_cents = (mid_price - half_spread).max(1);
        let ask_cents = mid_price + half_spread;
        let price_cents = if self.random.bool() { bid_cents } else { ask_cents };

        self.instruments[instrument_index].reference_price_cents = mid_price;

        MarketUpdate {
            instrument: self.instruments[instrument_index].symbol.clone(),
            price_cents,
            trade_quantity: self.random.range_inclusive(1, 1_000),
            bid_cents,
            ask_cents,
            bid_quantity: self.random.range_inclusive(0, 5_000),
            ask_quantity: self.random.range_inclusive(0, 5_000),
        }
    }
}

fn symbol_for(index: usize) -> String {
    NAMED_SYMBOLS
        .get(index)
        .map(|symbol| (*symbol).to_owned())
        .unwrap_or_else(|| format!("INST-{:03}", index + 1))
}

#[cfg(test)]
mod tests {
    use super::MarketGenerator;
    use std::collections::HashSet;

    fn assert_valid_batch(generator: &mut MarketGenerator, batch_size: usize) {
        let updates = generator.generate_batch(batch_size).expect("valid batch");
        assert_eq!(updates.len(), batch_size);
        for update in updates {
            assert!(update.price_cents > 0);
            assert!(update.bid_cents > 0);
            assert!(update.ask_cents > update.bid_cents);
            assert!(update.trade_quantity > 0);
            assert!(update.bid_quantity >= 0);
            assert!(update.ask_quantity >= 0);
            assert!(update.price_cents == update.bid_cents || update.price_cents == update.ask_cents);
        }
    }

    #[test]
    fn creates_unique_requested_instruments() {
        let generator = MarketGenerator::new(50, 11).expect("valid generator");
        let symbols = generator.instrument_symbols();
        assert_eq!(symbols.len(), 50);
        assert_eq!(symbols.iter().collect::<HashSet<_>>().len(), 50);
        assert_eq!(symbols[0], "ALFA");
        assert_eq!(symbols[49], "INST-050");
    }

    #[test]
    fn rejects_invalid_configuration_and_batch_sizes() {
        assert!(MarketGenerator::new(0, 1).is_err());
        assert!(MarketGenerator::new(51, 1).is_err());
        let mut generator = MarketGenerator::new(1, 1).expect("valid generator");
        assert!(generator.generate_batch(0).is_err());
        assert!(generator.generate_batch(1_001).is_err());
    }

    #[test]
    fn generates_valid_boundary_batches() {
        let mut generator = MarketGenerator::new(5, 42).expect("valid generator");
        assert_valid_batch(&mut generator, 1);
        assert_valid_batch(&mut generator, 1_000);
    }

    #[test]
    fn same_seed_reproduces_updates() {
        let mut left = MarketGenerator::new(5, 99).expect("left generator");
        let mut right = MarketGenerator::new(5, 99).expect("right generator");
        assert_eq!(
            left.generate_batch(100).expect("left batch"),
            right.generate_batch(100).expect("right batch")
        );
    }

    #[test]
    fn retains_and_evolves_instrument_state() {
        let mut generator = MarketGenerator::new(1, 123).expect("valid generator");
        let initial_price = generator.instruments[0].reference_price_cents;
        let first = generator.generate_batch(1).expect("first batch");
        let evolved_price = generator.instruments[0].reference_price_cents;
        let second = generator.generate_batch(1).expect("second batch");
        assert_ne!(initial_price, evolved_price);
        assert_ne!(first, second);
        assert_valid_batch(&mut generator, 100);
    }
}
