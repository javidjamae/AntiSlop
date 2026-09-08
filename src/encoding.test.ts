// The same prose, encoded the different ways real editors encode it, must
// produce the same findings.
//
// This is the class of bug that started the fixture work. `lint()` straightens
// the apostrophe precisely because model output is smart-quoted far more often
// than the plaintext corpora are, so a contraction-bearing pattern that was
// ASCII-only was blind to the text it most needed to catch. Nothing had been
// checking that property across the whole rule set; it was fixed once, for the
// rules someone thought to check.
//
// Encoding differences are invisible in a diff and invisible in a corpus sweep,
// because a corpus contains whatever encoding its authors happened to use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lint, severityFamily, headingDependentOpeners, demonstrativeHeadings } from './index.js'
import { resolveConfig, toLintExtras } from './config.js'
import { RULE_TRIGGERS, CUSTOM_PROBE, ENCODINGS } from './fixtures.js'

const rc = resolveConfig({ profile: 'strict', customRules: [CUSTOM_PROBE] })
const familiesOf = (text: string) =>
  [...new Set(lint(text, rc.rules, rc.banned, toLintExtras(rc)).map((v) => severityFamily(v.rule)))].sort()

test('every rule fires identically under every encoding of the same text', () => {
  for (const [rule, text] of Object.entries(RULE_TRIGGERS)) {
    const baseline = familiesOf(text)
    assert.ok(baseline.includes(rule), `fixture for "${rule}" does not fire it`)
    for (const [name, encode] of Object.entries(ENCODINGS)) {
      assert.deepEqual(
        familiesOf(encode(text)),
        baseline,
        `"${rule}" behaves differently under ${name}`
      )
    }
  }
})

test('line numbers survive every encoding', () => {
  // Straightening is index-preserving because U+2019 is one code unit, and a
  // BOM is one character on line 1. A finding that reports the wrong line is a
  // finding a writer cannot act on, and nothing else would catch the drift.
  const doc = 'A first ordinary line.\n\n## Three ways to run that\n\nAnd a closing line.\n'
  for (const [name, encode] of Object.entries(ENCODINGS)) {
    const hits = lint(encode(doc), rc.rules, rc.banned, toLintExtras(rc)).filter(
      (v) => v.rule === 'demonstrative-heading'
    )
    assert.equal(hits.length, 1, `${name}: expected exactly one heading finding`)
    assert.equal(hits[0]!.line, 3, `${name}: reported line ${hits[0]!.line}, not 3`)
  }
})

test('the structural exports match lint() under every encoding', () => {
  // These are public and a host may call them directly, which means they do not
  // get lint()'s normalization for free.
  const heading = '## Training the blog\n\nThis is where it learns.\n'
  const demo = '## Three ways to run that\n'
  for (const [name, encode] of Object.entries(ENCODINGS)) {
    assert.equal(headingDependentOpeners(encode(heading)).length, 1, `headingDependentOpeners under ${name}`)
    assert.equal(demonstrativeHeadings(encode(demo)).length, 1, `demonstrativeHeadings under ${name}`)
  }
})

test('a contraction-bearing pattern catches both apostrophes', () => {
  // Named separately from the sweep above because this is the specific defect
  // that was found in the wild: the rules most needing to fire on model output
  // were the ones blind to how model output is punctuated.
  for (const text of [
    "Here's why this matters.",
    "The gap is not luck. It's process failure.",
    "It's important to note this.",
  ]) {
    const straight = familiesOf(text)
    assert.ok(straight.length > 0, `nothing fires on "${text}"`)
    assert.deepEqual(familiesOf(text.replace(/'/g, '’')), straight, `smart-quoted "${text}" differs`)
  }
})

test('a no-break space is reported rather than normalized away', () => {
  // NBSP is deliberately excluded from the encoding sweep: substituting it is
  // not encoding-neutral, because reporting it is a rule. Pinned here so a
  // future normalization pass cannot silently swallow the thing being reported.
  const hits = lint('a b', rc.rules, rc.banned, toLintExtras(rc)).filter(
    (v) => v.rule === 'invisible-unicode'
  )
  assert.equal(hits.length, 1)
  assert.match(hits[0]!.suggestion ?? '', /NO-BREAK SPACE/)
})

test('an empty document and a whitespace-only document find nothing', () => {
  for (const text of ['', '\n', '   ', '\r\n\r\n', '﻿', '﻿\n']) {
    assert.deepEqual(
      lint(text, rc.rules, rc.banned, toLintExtras(rc)),
      [],
      `${JSON.stringify(text)} produced findings`
    )
  }
})
