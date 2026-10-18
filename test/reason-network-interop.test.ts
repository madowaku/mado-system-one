import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, qualify, type AgentRecord, type Envelope, type Policy } from "../src/coding/reason-network-interop.js";
const agents: AgentRecord[] = [
  { id: "codex", role: "implementer", enabled: true, capabilities: ["delegation"] },
  { id: "claude", role: "reviewer", enabled: true, capabilities: ["delegation"] },
  { id: "offline", role: "researcher", enabled: false, capabilities: [] },
];
const envelope: Envelope = { version: 1, id: "msg1", from: "codex", to: "claude", kind: "delegate", taskId: "task1", payload: "Review diff", expiresAt: "2030-01-01T00:00:00.000Z" };
const policy: Policy = { mode: "dry_run", allowedKinds: ["ping", "status", "delegate", "result"], timeoutMs: 2000, maxPayloadBytes: 1024, now: () => new Date("2026-10-18T00:00:00Z") };
test("dry run never calls transport", async () => {
  let calls = 0;
  const r = await dispatch(envelope, agents, policy, { send: async () => { calls++; return { acknowledged: true }; } });
  assert.equal(r.status, "dry_run"); assert.equal(calls, 0);
});
test("live requires explicitly provided transport", async () => {
  const r = await dispatch(envelope, agents, { ...policy, mode: "live" });
  assert.equal(r.reason, "live_transport_not_configured");
});
test("live uses injected transport and returns receipt", async () => {
  const r = await dispatch(envelope, agents, { ...policy, mode: "live" }, { send: async (_m, opts) => {
    assert.equal(opts.timeoutMs, 2000); return { acknowledged: true, receiptId: "receipt1" };
  } });
  assert.equal(r.status, "acknowledged"); assert.equal(r.receiptId, "receipt1");
});
test("fails closed for disabled peer, oversized messages, expiry and invalid IDs", () => {
  assert.equal(qualify({ ...envelope, to: "offline" }, agents, policy).reason, "unknown_or_disabled_peer");
  assert.equal(qualify({ ...envelope, payload: "あ".repeat(400) }, agents, policy).reason, "payload_too_large");
  assert.equal(qualify({ ...envelope, expiresAt: "2020-01-01" }, agents, policy).reason, "expired_message");
  assert.equal(qualify({ ...envelope, id: "../bad" }, agents, policy).reason, "invalid_envelope");
});
test("delegation requires explicit target capability", () => {
  const peers = agents.map(a => a.id === "claude" ? { ...a, capabilities: [] } : a);
  assert.equal(qualify(envelope, peers, policy).reason, "delegate_capability_missing");
});
test("transport exceptions are bounded and redacted", async () => {
  const r = await dispatch(envelope, agents, { ...policy, mode: "live" }, { send: async () => { throw new Error("secret"); } });
  assert.deepEqual(r, { status: "transport_error", reason: "transport_failed" });
});
