import assert from "node:assert/strict";
import test from "node:test";
import {
  DECISION_MODEL_PROVIDER_MATRIX,
  decisionModelProvider,
} from "../src/providers/matrix.js";

test("decision model provider matrix has unique ids", () => {
  const ids = DECISION_MODEL_PROVIDER_MATRIX.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("implemented adapter modalities never exceed upstream model modalities", () => {
  for (const entry of DECISION_MODEL_PROVIDER_MATRIX) {
    for (const modality of entry.adapterModalities) {
      assert.ok(
        entry.upstreamModalities.includes(modality),
        `${entry.id} adapter modality ${modality} is not upstream-supported`,
      );
    }
  }
});

test("Clef intake records multimodal upstream support but text-only MADO authority", () => {
  const clef = decisionModelProvider("clef");
  assert.ok(clef);
  assert.equal(clef.adapterStatus, "implemented");
  assert.deepEqual(clef.adapterModalities, ["text"]);
  assert.ok(clef.upstreamModalities.includes("text+vision"));
  assert.equal(clef.maxQuestions, 64);
  assert.equal(clef.calibrationStatus, "unknown");
});

test("Jev remains a planned comparison target rather than a fake active adapter", () => {
  const jev = decisionModelProvider("jev");
  assert.ok(jev);
  assert.equal(jev.adapterStatus, "planned");
  assert.deepEqual(jev.adapterModalities, []);
});
