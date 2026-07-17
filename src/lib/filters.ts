// Shared DataTable filter predicates. `q` arrives already lowercased/trimmed.

export const nameOrPid = (r: { name: string; pid: number }, q: string) =>
  r.name.toLowerCase().includes(q) || String(r.pid) === q;

export const svcFilter = (r: { name: string; display: string; pid: number }, q: string) =>
  r.name.toLowerCase().includes(q) ||
  r.display.toLowerCase().includes(q) ||
  String(r.pid) === q;

export const connFilter = (
  r: { process: string; local: string; remote: string; pid: number },
  q: string,
) =>
  r.process.toLowerCase().includes(q) ||
  r.local.toLowerCase().includes(q) ||
  r.remote.toLowerCase().includes(q) ||
  String(r.pid) === q;
