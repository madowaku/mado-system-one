import assert from "node:assert/strict";
import test from "node:test";

import { MockSystemOneProvider } from "../src/index.js";

test("provider capabilities expose inference, confidence, calibration, and pattern semantics", () => {
  const provider = new MockSystemOneProvider({
    capabilities: {
      inferenceFamily: "encoder_scoring",
      specialization: "general",
      probabilitySemantics: "heuristic",
      confidenceSemantics: "normalized_entropy",
      calibration: {
        status: "uncalibrated",
        method: "temperature-scaling-pending",
      },
      patternSupport: {
        sieve: {
          status: "experimental",
          evidenceRef: "eval/context-sieve-v0",
        },
        gate: {
          status: "unknown",
        },
      },
    },
    responder: {
      traceId: "unused",
      providerId: "mock",
      probabilitySemantics: "heuristic",
      results: {},
    },
  });

  const capabilities = provider.capabilities();

  assert.equal(capabilities.inferenceFamily, "encoder_scoring");
  assert.equal(capabilities.specialization, "general");
  assert.equal(capabilities.confidenceSemantics, "normalized_entropy");
  assert.equal(capabilities.calibration.status, "uncalibrated");
  assert.equal(capabilities.patternSupport?.sieve?.status, "experimental");
  assert.equal(capabilities.patternSupport?.gate?.status, "unknown");
});

test("mock provider defaults never pretend to be calibrated", () => {
  const provider = new MockSystemOneProvider({
    responder: {
      traceId: "unused",
      providerId: "mock",
      probabilitySemantics: "heuristic",
      results: {},
    },
  });

  const capabilities = provider.capabilities();

  assert.equal(capabilities.inferenceFamily, "unknown");
  assert.equal(capabilities.confidenceSemantics, "unknown");
  assert.equal(capabilities.calibration.status, "uncalibrated");
});
