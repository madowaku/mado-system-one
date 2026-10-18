/**
 * MSO-DM-M0.6: transport-neutral Reason Network interop qualification.
 * This is deliberately NOT an implementation of an undocumented Reason wire protocol.
 * An explicit, reviewed transport adapter must be supplied before live connectivity.
 */
export type AgentRole = "implementer" | "reviewer" | "researcher";
export type MessageKind = "ping" | "status" | "delegate" | "result";
export type Mode = "dry_run" | "live";
export interface AgentRecord {
  id: string;
  role: AgentRole;
  enabled: boolean;
  capabilities: string[];
}
export interface Envelope {
  version: 1;
  id: string;
  from: string;
  to: string;
  kind: MessageKind;
  taskId: string;
  payload: string;
  expiresAt: string;
}
export interface Decision {
  allowed: boolean;
  reason: string;
  mode: Mode;
  envelope: Envelope;
}
export interface Transport {
  send(envelope: Envelope, opts: { timeoutMs: number }): Promise<{ acknowledged: boolean; receiptId?: string }>;
}
export interface Policy {
  mode: Mode;
  allowedKinds: MessageKind[];
  timeoutMs: number;
  maxPayloadBytes: number;
  now?: () => Date;
}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const kinds: MessageKind[] = ["ping", "status", "delegate", "result"];
function validId(value: string): boolean { return ID.test(value); }
export function validateRegistry(agents: AgentRecord[]): void {
  if (!Array.isArray(agents) || agents.length === 0) throw new Error("empty_registry");
  const seen = new Set<string>();
  for (const a of agents) {
    if (!a || !validId(a.id) || !["implementer","reviewer","researcher"].includes(a.role) ||
        typeof a.enabled !== "boolean" || !Array.isArray(a.capabilities) ||
        !a.capabilities.every(c => typeof c === "string" && validId(c)))
      throw new Error("invalid_agent");
    if (seen.has(a.id)) throw new Error("duplicate_agent");
    seen.add(a.id);
  }
}
export function qualify(envelope: Envelope, agents: AgentRecord[], policy: Policy): Decision {
  const deny = (reason: string): Decision => ({ allowed: false, reason, mode: policy.mode, envelope });
  validateRegistry(agents);
  if (policy.mode !== "dry_run" && policy.mode !== "live") return deny("invalid_mode");
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 30000 ||
      !Number.isInteger(policy.maxPayloadBytes) || policy.maxPayloadBytes < 1 || policy.maxPayloadBytes > 65536)
    return deny("invalid_policy");
  if (!envelope || envelope.version !== 1 || !validId(envelope.id) ||
      !validId(envelope.from) || !validId(envelope.to) || !validId(envelope.taskId) ||
      !kinds.includes(envelope.kind) || typeof envelope.payload !== "string")
    return deny("invalid_envelope");
  if (Buffer.byteLength(envelope.payload, "utf8") > policy.maxPayloadBytes) return deny("payload_too_large");
  if (!policy.allowedKinds.includes(envelope.kind)) return deny("kind_not_allowed");
  if (envelope.from === envelope.to) return deny("self_message");
  const from = agents.find(a => a.id === envelope.from);
  const to = agents.find(a => a.id === envelope.to);
  if (!from?.enabled || !to?.enabled) return deny("unknown_or_disabled_peer");
  if (envelope.kind === "delegate" && !to.capabilities.includes("delegation")) return deny("delegate_capability_missing");
  const expiry = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= (policy.now?.() ?? new Date()).getTime()) return deny("expired_message");
  return { allowed: true, reason: "qualified", mode: policy.mode, envelope };
}
export async function dispatch(envelope: Envelope, agents: AgentRecord[], policy: Policy, transport?: Transport):
  Promise<{ status: "denied" | "dry_run" | "acknowledged" | "unacknowledged" | "transport_error"; reason: string; receiptId?: string }> {
  const d = qualify(envelope, agents, policy);
  if (!d.allowed) return { status: "denied", reason: d.reason };
  if (policy.mode === "dry_run") return { status: "dry_run", reason: "no_external_calls" };
  if (!transport) return { status: "denied", reason: "live_transport_not_configured" };
  try {
    const result = await transport.send(envelope, { timeoutMs: policy.timeoutMs });
    return result.acknowledged ?
      { status: "acknowledged", reason: "transport_ack", ...(result.receiptId ? { receiptId: result.receiptId } : {}) } :
      { status: "unacknowledged", reason: "transport_no_ack" };
  } catch {
    return { status: "transport_error", reason: "transport_failed" };
  }
}
