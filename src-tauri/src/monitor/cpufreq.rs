use windows::core::w;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterValue, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};

/// Contador PDH "% Processor Performance" (100 = frecuencia base).
/// Se usa la variante English para que funcione en Windows localizados.
pub struct CpuFreq {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
    ok: bool,
}

// Los handles PDH pueden usarse desde otro thread si las llamadas no son concurrentes;
// el Mutex del estado garantiza eso.
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
            // primera recogida: los contadores de tasa necesitan dos muestras
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
