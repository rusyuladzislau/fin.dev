/// Small seedable PRNG used inside Wasm so generation is reproducible in tests.
#[derive(Debug, Clone)]
pub struct RandomSource {
    state: u64,
}

impl RandomSource {
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    pub fn range_inclusive(&mut self, min: i64, max: i64) -> i64 {
        assert!(min <= max, "random range minimum must not exceed maximum");
        let span = (max - min + 1) as u64;
        min + (self.next_u64() % span) as i64
    }

    pub fn bool(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

#[cfg(test)]
mod tests {
    use super::RandomSource;

    #[test]
    fn same_seed_produces_same_sequence() {
        let mut left = RandomSource::new(42);
        let mut right = RandomSource::new(42);
        for _ in 0..20 {
            assert_eq!(left.next_u64(), right.next_u64());
        }
    }

    #[test]
    fn ranged_values_stay_within_bounds() {
        let mut random = RandomSource::new(7);
        for _ in 0..1_000 {
            let value = random.range_inclusive(-10, 10);
            assert!((-10..=10).contains(&value));
        }
    }
}
