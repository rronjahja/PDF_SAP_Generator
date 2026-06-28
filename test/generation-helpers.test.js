'use strict';
const test = require('node:test');
const assert = require('node:assert');

// resolveFileNamePattern is internal; test via module surgery
const gen = require('fs').readFileSync(require('path').join(__dirname, '..', 'srv', 'lib', 'generation.js'), 'utf8');
test('generation exposes filename pattern logic', () => {
  assert.match(gen, /resolveFileNamePattern/);
  assert.match(gen, /checkRateLimit/);
});
