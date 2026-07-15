use windows::core::w;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterValue, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};

/// PDH counter "% Processor Performance" (100 = base frequency).
/// The English variant is used so it works on localized Windows.
pub struct CpuFreq {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
    ok: bool,
}

// PDH handles can be used from another thread if the calls aren't concurrent;
// the state Mutex guarantees that.
unsafe impl Send for CpuFreq {}

impl CpuFreq {
    pub fn new() -> Self {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return Self { query, counter: PDH_HCOUNTER::default(), ok: false };
            }
            let mut counter = PDH_HCOUNTER::default();
            let path = w!("\\Processor Information(_Total)\\% Processor Performance");
            if PdhAddEnglishCounterW(query, path, 0, &mut counter) != 0 {
                return Self { query, counter, ok: false };
            }
            // first collect: rate counters need two samples
            PdhCollectQueryData(query);
            Self { query, counter, ok: true }
        }
    }

    pub fn performance_percent(&self) -> Option<f64> {
        if !self.ok {
            return None;
        }
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            let mut value = PDH_FMT_COUNTERVALUE::default();
            if PdhGetFormattedCounterValue(self.counter, PDH_FMT_DOUBLE, None, &mut value) != 0 {
                return None;
            }
            Some(value.Anonymous.doubleValue)
        }
    }
}
