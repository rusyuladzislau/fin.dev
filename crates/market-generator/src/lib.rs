mod generator;
mod models;
mod random;

use generator::MarketGenerator;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmMarketGenerator {
    inner: MarketGenerator,
}

#[wasm_bindgen]
impl WasmMarketGenerator {
    #[wasm_bindgen(constructor)]
    pub fn new(instrument_count: usize, seed: u32) -> Result<WasmMarketGenerator, JsValue> {
        MarketGenerator::new(instrument_count, u64::from(seed))
            .map(|inner| WasmMarketGenerator { inner })
            .map_err(|message| JsValue::from_str(&message))
    }

    #[wasm_bindgen(js_name = instrumentSymbols)]
    pub fn instrument_symbols(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.instrument_symbols())
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = generateBatch)]
    pub fn generate_batch(&mut self, batch_size: usize) -> Result<JsValue, JsValue> {
        self.inner
            .generate_batch(batch_size)
            .map_err(|message| JsValue::from_str(&message))
            .and_then(|updates| {
                serde_wasm_bindgen::to_value(&updates)
                    .map_err(|error| JsValue::from_str(&error.to_string()))
            })
    }
}
