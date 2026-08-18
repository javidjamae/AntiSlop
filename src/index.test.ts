import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lint, NEUTRAL, STRICT, demonstrativeHeadings, headingDependentOpeners, resolveConfig } from './index.js'
import { VERSION } from './version.js'

test('VERSION matches package.json (release script syncs both)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

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

test('invisible unicode: zero-width, soft hyphen, NNBSP, tag block — under every profile', () => {
  const hit = (s: string) => lint(s, NEUTRAL).filter((v) => v.rule === 'invisible-unicode')
  assert.equal(hit('war​plan').length, 1)
  assert.ok(hit('soft­hyphen')[0].suggestion?.includes('SOFT HYPHEN'))
  assert.ok(hit('a b')[0].suggestion?.includes('NARROW NO-BREAK SPACE'))
  assert.ok(hit('clean\u{E0041}text')[0].suggestion?.includes('TAG CHARACTER'))
})

test('invisible unicode: ignores the skip mask — hidden chars in code still flag', () => {
  assert.equal(lint('`a​b`', NEUTRAL).filter((v) => v.rule === 'invisible-unicode').length, 1)
})

test('invisible unicode carve-outs: emoji ZWJ, emoji VS16, keycaps, Persian ZWNJ, file BOM', () => {
  const hit = (s: string) => lint(s, NEUTRAL).filter((v) => v.rule === 'invisible-unicode')
  assert.equal(hit('family: \u{1F468}‍\u{1F469}‍\u{1F467}').length, 0)
  assert.equal(hit('done ✔️ yes').length, 0)
  assert.equal(hit('press 1️⃣ now').length, 0)
  assert.equal(hit('می‌خواهم').length, 0)
  assert.equal(hit('﻿title at file start').length, 0)
})

test('invisible unicode: variation-selector runs are called out as hidden data', () => {
  const hits = lint('x︀︁︂y', NEUTRAL).filter((v) => v.rule === 'invisible-unicode')
  assert.equal(hits.length, 3)
  assert.ok(hits[0].suggestion?.includes('RUN'))
})

test('config: profile + rule overrides + voice phrase add/remove', () => {
  const rc = resolveConfig({
    profile: 'strict',
    rules: { emDash: false },
    bannedPhrases: { add: ['synergy'], remove: ['robust'] },
  })
  const rules = (s: string) => lint(s, rc.rules, rc.banned).map((v) => v.rule)
  assert.ok(!rules('a — b').includes('em-dash')) // override wins over profile
  assert.ok(rules('well... maybe').includes('ellipsis')) // strict base kept
  assert.ok(rules('true synergy here').some((r) => r.includes('synergy'))) // site voice ban
  assert.ok(!rules('This API is robust.').some((r) => r.includes('robust'))) // site exemption
})

test('config: custom rules fire as custom:<id> and honor the skip mask', () => {
  const rc = resolveConfig({
    customRules: [{ id: 'no-passive-belief', pattern: '\\bwe believe\\b', suggestion: 'State it as fact or attribute it.' }],
  })
  const extras = { openers: rc.openers, customRules: rc.customRules }
  assert.ok(lint('And we believe this works.', rc.rules, rc.banned, extras).some((v) => v.rule === 'custom: no-passive-belief'))
  assert.equal(lint('`we believe` is the phrase', rc.rules, rc.banned, extras).filter((v) => v.rule.startsWith('custom:')).length, 0)
})

test('config: array form replaces the phrase list wholesale', () => {
  const rc = resolveConfig({ bannedPhrases: ['flurgle'] })
  assert.ok(lint('a flurgle appears', rc.rules, rc.banned).some((v) => v.rule.includes('flurgle')))
  assert.equal(lint('We delve into details.', rc.rules, rc.banned).length, 0)
})


test('contrast slop: comma form and "not just X, but Y"', () => {
  assert.ok(rulesOf("It's not a tool problem, it's a standards problem.").includes('contrast-slop'))
  assert.ok(rulesOf('The linter is not just a checker, but a teacher.').includes('contrast-slop'))
  // Overlapping patterns report ONCE per span.
  const hits = lint("It's not just a checker, but a teacher.", STRICT).filter((v) => v.rule === 'contrast-slop')
  assert.equal(hits.length, 1)
})

test('arrows: breadcrumb, pipeline, and back-link are exempt; prose arrows still fire', () => {
  assert.ok(!rulesOf('Go to Settings → Connections → Delete.').includes('arrow-symbol'))
  assert.ok(!rulesOf('Input → Transform → Output').includes('arrow-symbol'))
  assert.ok(!rulesOf('← All guides').includes('arrow-symbol'))
  assert.ok(rulesOf('this leads → that').includes('arrow-symbol'))
  assert.ok(rulesOf('more slop → worse writing').includes('arrow-symbol'))
  assert.ok(rulesOf('do it 👉 now').includes('arrow-symbol'))
})

test('arrows: trailing-CTA exemption is config opt-in, off by default', () => {
  const cta = 'Install from the App Store →'
  assert.ok(lint(cta, STRICT).some((v) => v.rule === 'arrow-symbol'))
  assert.ok(!lint(cta, STRICT, undefined, { arrows: { trailingCta: true } }).some((v) => v.rule === 'arrow-symbol'))
  assert.ok(!lint('[Read the docs →](https://example.com)', STRICT, undefined, { arrows: { trailingCta: true } }).some((v) => v.rule === 'arrow-symbol'))
})

test('clean prose is clean', () => {
  assert.equal(lint('How to trim silence from a video', STRICT).length, 0)
})
