import assert from 'node:assert/strict';
import { clamp } from './src/clamp.mjs';
assert.equal(clamp(-4, 0, 10), 0);
assert.equal(clamp(4, 0, 10), 4);
assert.equal(clamp(40, 0, 10), 10);
assert.throws(() => clamp(0, 10, 0), RangeError);
console.log('clamp tests pass');
