import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lint, NEUTRAL, STRICT, demonstrativeHeadings, headingDependentOpeners } from './index.js'

const rulesOf = (t: string, rules = STRICT) => lint(t, rules).map((v) => v.rule)

test('universal artifacts fire under every profile', () => {
  assert.ok(lint('\u{1D400}\u{1D401}', NEUTRAL).some((v) => v.rule === 'unicode-bold'))
  assert.ok(lint('💬 What do you think?', NEUTRAL).some((v) => v.rule === 'engagement-bait'))
})

test('taste rules: off in NEUTRAL, on in STRICT', () => {
  assert.ok(!rulesOf('a — b', NEUTRAL).includes('em-dash'))
  assert.ok(rulesOf('a — b').includes('em-dash'))
  assert.ok(rulesOf('well... maybe').includes('ellipsis'))
  assert.ok(!rulesOf('well... maybe', NEUTRAL).includes('ellipsis'))
})

test('skip mask exempts code, quotes, and link URLs', () => {
  assert.equal(lint('`a — b` and `range(0, ...)`', STRICT).length, 0)
  assert.equal(lint('> a quoted — source... ok', STRICT).length, 0)
  assert.ok(!rulesOf('[see](https://x.com/a—b)').includes('em-dash'))
})

test('reversed antithesis: trailing ", not X" flourish', () => {
  assert.ok(rulesOf('The demo is that system, live, not a deck about it.').includes('reversed-antithesis'))
  assert.ok(!rulesOf('The check is not expensive to run.').includes('reversed-antithesis'))
})

test('contrast slop: negation reasserted', () => {
  assert.ok(rulesOf("The gap is not luck. It's process failure.").includes('contrast-slop'))
})

test('banned openers positional, banned phrases word-bounded', () => {
  assert.ok(rulesOf("Here's why this matters.").some((r) => r.includes('banned opener')))
  assert.ok(rulesOf('This API is robust.').some((r) => r.includes('robust')))
  assert.ok(!rulesOf('Its robustness is fine.').some((r) => r.includes('robust')))
})

test('demonstrative headings: non-question H2/H3 ending on it/this/that', () => {
  assert.equal(demonstrativeHeadings('## Three ways to run that\n### You just talk to it\n').length, 2)
  assert.equal(demonstrativeHeadings('### Can I use the tool without installing it?\n').length, 0)
  assert.equal(demonstrativeHeadings('## Common Frame Rates and When to Use Them\n').length, 0)
  assert.equal(demonstrativeHeadings('## What you bring with you\n').length, 0)
})

test('heading-dependent openers: bare referring word under a heading', () => {
  assert.equal(headingDependentOpeners('## Training the blog\n\nThis is where it learns.\n').length, 1)
  assert.equal(headingDependentOpeners('## Training the blog\n\nTraining means teaching the system.\n').length, 0)
  assert.equal(headingDependentOpeners('## X vs Y\n\nBoth n8n and Make can call the API.\n').length, 0)
})

test('clean prose is clean', () => {
  assert.equal(lint('How to trim silence from a video', STRICT).length, 0)
})
