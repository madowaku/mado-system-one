import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStarterRegistry } from "../src/coding/free-agent-bootstrap.js";
import { DelegationRouter, MODEL_ROLES } from "../src/coding/free-agent-delegation.js";

test("one-command bootstrap generates safe offline registry for all three roles", async t => {
  const root = process.cwd();
  const registry = await createStarterRegistry(root);
  const keys = Object.keys(registry).sort();
  assert.deepEqual(keys, ["public:implement","public:long_context","public:review"]);
  const router = new DelegationRouter({repoRoot:root, registry});
  for (const role of ["implement","review","long_context"] as const) {
    const job = registry["public:"+role];
    assert.ok(job);
    assert.equal(job.providerId, MODEL_ROLES[role]);
    assert.equal(job.approval.externalTransmission, false);
    assert.equal(job.approval.spendingRisk, false);
    assert.equal(job.approval.networkEgressControlled, false);
    assert.match(job.image, /^ghcr\.io\/replace-with-reviewed-opencode@sha256:0{64}$/);
    const result = await router.delegate({role,taskRef:"public:"+role,privacy:"approved_public"});
    assert.equal(result.mode,"dry_run");
    assert.equal(result.externalCallsMade,false);
    await assert.rejects(
      router.delegate({role,taskRef:"public:"+role,privacy:"approved_public",mode:"execute"}),
      /authorization is absent/,
    );
  }
});
