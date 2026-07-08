use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct Connection {
    pub pid: u32,
    pub process: String,
    pub protocol: String,
    pub local: String,
    pub remote: String,
    pub state: String,
}

pub fn collect(names: &HashMap<u32, String>) -> Vec<Connection> {
    let af = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let Ok(sockets) = get_sockets_info(af, proto) else {
        return Vec::new();
    };
    sockets
        .into_iter()
        .map(|s| {
            let pid = s.associated_pids.first().copied().unwrap_or(0);
            let process = names.get(&pid).cloned().unwrap_or_else(|| "?".into());
            match &s.protocol_socket_info {
                ProtocolSocketInfo::Tcp(t) => Connection {
                    pid,
                    process,
                    protocol: "TCP".into(),
                    local: format!("{}:{}", t.local_addr, t.local_port),
                    remote: format!("{}:{}", t.remote_addr, t.remote_port),
                    state: t.state.to_string(),
                },
                ProtocolSocketInfo::Udp(u) => Connection {
                    pid,
                    process,
                    protocol: "UDP".into(),
                    local: format!("{}:{}", u.local_addr, u.local_port),
                    remote: "*".into(),
                    state: String::new(),
                },
            }
        })
        .collect()
}
