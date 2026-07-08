use windows::core::PCWSTR;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterValue, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};

/// Contadores PDH de memoria y por disco lógico (nombres English).
pub struct SysCounters {
    query: PDH_HQUERY,
    ok: bool,
    standby: [PDH_HCOUNTER; 3],
    modified: PDH_HCOUNTER,
    free_zero: PDH_HCOUNTER,
    hard_faults: PDH_HCOUNTER,
    committed: PDH_HCOUNTER,
    commit_limit: PDH_HCOUNTER,
    // (instancia, % tiempo activo, cola actual)
    disks: Vec<(String, PDH_HCOUNTER, PDH_HCOUNTER)>,
}

// Ver nota de Send en cpufreq.rs: el Mutex del estado serializa las llamadas.
unsafe impl Send for SysCounters {}

pub struct MemCounters {
    pub standby: u64,
    pub modified: u64,
    pub free_zero: u64,
    pub hard_faults_ps: f64,
    pub committed: u64,
    pub commit_limit: u64,
}

fn add(query: PDH_HQUERY, path: &str) -> PDH_HCOUNTER {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut counter = PDH_HCOUNTER::default();
    unsafe {
        PdhAddEnglishCounterW(query, PCWSTR(wide.as_ptr()), 0, &mut counter);
    }
    counter
}

impl SysCounters {
    /// `disk_instances`: unidades lógicas tipo "C:".
    pub fn new(disk_instances: &[String]) -> Self {
        unsafe {
            let mut query = PDH_HQUERY::default();
            let ok = PdhOpenQueryW(None, 0, &mut query) == 0;
            let mut s = Self {
                query,
                ok,
                standby: [PDH_HCOUNTER::default(); 3],
                modified: PDH_HCOUNTER::default(),
                free_zero: PDH_HCOUNTER::default(),
                hard_faults: PDH_HCOUNTER::default(),
                committed: PDH_HCOUNTER::default(),
                commit_limit: PDH_HCOUNTER::default(),
                disks: Vec::new(),
            };
            if !ok {
                return s;
            }
            s.standby = [
                add(query, "\\Memory\\Standby Cache Normal Priority Bytes"),
                add(query, "\\Memory\\Standby Cache Reserve Bytes"),
                add(query, "\\Memory\\Standby Cache Core Bytes"),
            ];
            s.modified = add(query, "\\Memory\\Modified Page List Bytes");
            s.free_zero = add(query, "\\Memory\\Free & Zero Page List Bytes");
            s.hard_faults = add(query, "\\Memory\\Pages Input/sec");
            s.committed = add(query, "\\Memory\\Committed Bytes");
            s.commit_limit = add(query, "\\Memory\\Commit Limit");
            for inst in disk_instances {
                s.disks.push((
                    inst.clone(),
                    add(query, &format!("\\LogicalDisk({inst})\\% Disk Time")),
                    add(query, &format!("\\LogicalDisk({inst})\\Current Disk Queue Length")),
                ));
            }
            // primera muestra para los contadores de tasa
            PdhCollectQueryData(query);
            s
        }
    }

    pub fn collect(&self) -> bool {
        if !self.ok {
            return false;
        }
        unsafe { PdhCollectQueryData(self.query) == 0 }
    }

    fn read(&self, counter: PDH_HCOUNTER) -> Option<f64> {
        if counter.is_invalid() {
            return None;
        }
        unsafe {
            let mut value = PDH_FMT_COUNTERVALUE::default();
            if PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, None, &mut value) != 0 {
                return None;
            }
            Some(value.Anonymous.doubleValue)
        }
    }

    /// Leer tras collect().
    pub fn memory(&self) -> MemCounters {
        let standby = self
            .standby
            .iter()
            .filter_map(|c| self.read(*c))
            .sum::<f64>() as u64;
        MemCounters {
            standby,
            modified: self.read(self.modified).unwrap_or(0.0) as u64,
            free_zero: self.read(self.free_zero).unwrap_or(0.0) as u64,
            hard_faults_ps: self.read(self.hard_faults).unwrap_or(0.0),
            committed: self.read(self.committed).unwrap_or(0.0) as u64,
            commit_limit: self.read(self.commit_limit).unwrap_or(0.0) as u64,
        }
    }

    /// (% activo, cola) de una unidad, tras collect().
    pub fn disk(&self, instance: &str) -> (f64, f64) {
        for (inst, active, queue) in &self.disks {
            if inst == instance {
                return (
                    self.read(*active).unwrap_or(0.0).min(100.0),
                    self.read(*queue).unwrap_or(0.0),
                );
            }
        }
        (0.0, 0.0)
    }
}
