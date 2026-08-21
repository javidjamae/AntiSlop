import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lint, NEUTRAL, STRICT, demonstrativeHeadings, headingDependentOpeners, resolveConfig, VERSION } from './index.js'


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
  assert.ok(!rulesOf('do it 👉 now').includes('arrow-symbol')) // an emoji, owned by emoji-decoration
})

test('arrows: trailing-CTA exemption is config opt-in, off by default', () => {
  const cta = 'Install from the App Store →'
  assert.ok(lint(cta, STRICT).some((v) => v.rule === 'arrow-symbol'))
  assert.ok(!lint(cta, STRICT, undefined, { arrows: { trailingCta: true } }).some((v) => v.rule === 'arrow-symbol'))
  assert.ok(!lint('[Read the docs →](https://example.com)', STRICT, undefined, { arrows: { trailingCta: true } }).some((v) => v.rule === 'arrow-symbol'))
})


// Regression table for the surrogate-pair class of bug: an astral literal
// inside a character class without the `u` flag matches either code unit
// independently. Generated empirically, one codepoint per run. Individual
// cases would only pin these characters; the table pins the defect class,
// which reappears the moment another astral literal enters a class.
//
// The D83C rows are the control that rules out "the emoji rule bleeds into
// the arrow rule": they are astral emoji that were never affected. U+2B50 and
// U+2705 are BMP emoji, same control from the other direction. The final
// three rows are real arrows and guard against over-correcting the fix.
const ARROW_EMOJI_TABLE: [string, string, number, number][] = [
  // char, name, expected arrow-symbol count, expected emoji-decoration count
  ['\u{1F680}', 'rocket (astral D83D)', 0, 1],
  ['\u{1F517}', 'link (astral D83D)', 0, 1],
  ['\u{1F480}', 'skull (astral D83D)', 0, 1],
  ['\u{1F600}', 'grin (astral D83D)', 0, 1],
  ['\u{1F4F7}', 'camera (astral D83D)', 0, 1],
  ['\u{1F400}', 'rat (astral D83D)', 0, 1],
  ['\u{1F449}', 'pointing hand (astral D83D, double-reported)', 0, 1],
  ['\u{1F3C6}', 'trophy (astral D83C, control)', 0, 1],
  ['\u{1F3AF}', 'target (astral D83C, control)', 0, 1],
  ['\u{1F31F}', 'glowing star (astral D83C, control)', 0, 1],
  ['\u{2B50}', 'star (BMP emoji, control)', 0, 1],
  ['\u{2705}', 'check mark (BMP emoji, control)', 0, 1],
  ['\u{2192}', 'rightwards arrow (real)', 1, 0],
  ['\u{21D2}', 'double arrow (real)', 1, 0],
  ['\u{2190}', 'leftwards arrow (real)', 1, 0],
]

test('arrow-symbol vs emoji-decoration: surrogate-pair regression table', () => {
  for (const [char, name, expectedArrows, expectedEmoji] of ARROW_EMOJI_TABLE) {
    const found = lint(`A line with ${char} in it.`, STRICT)
    const arrows = found.filter((v) => v.rule === 'arrow-symbol').length
    const emoji = found.filter((v) => v.rule === 'emoji-decoration').length
    assert.equal(arrows, expectedArrows, `${name}: arrow-symbol`)
    assert.equal(emoji, expectedEmoji, `${name}: emoji-decoration`)
  }
})

test('VERSION is exported from the package entrypoint (consumers read it)', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
})

test('config: an unknown rule key THROWS instead of silently no-opping', () => {
  // The original defect: { ...base, ...cfg.rules } absorbed a kebab id as a
  // junk property while the real camelCase key kept its profile value, so the
  // config looked applied, the exit code was unchanged, and the rule stayed on.
  assert.throws(() => resolveConfig({ rules: { reversedAntithesisX: false } as never }), /unknown rule/)
  assert.throws(() => resolveConfig({ rules: { 'em_dash': false } as never }), /unknown rule/)
})

test('config: kebab rule IDs work as aliases for camelCase keys', () => {
  // Findings print kebab ids, so a config written from CLI output must work.
  // Several are not mechanical conversions, which is why aliasing beats docs.
  const line = 'It is a plain sentence, not a fancy one.'
  assert.equal(lint(line, resolveConfig({ profile: 'strict' }).rules).filter((v) => v.rule === 'reversed-antithesis').length, 1)
  for (const key of ['reversed-antithesis', 'reversedAntithesis']) {
    const rc = resolveConfig({ profile: 'strict', rules: { [key]: false } as never })
    assert.equal(lint(line, rc.rules).filter((v) => v.rule === 'reversed-antithesis').length, 0, key)
  }
  // The non-mechanical ones specifically.
  assert.equal(resolveConfig({ rules: { 'arrow-symbol': false } as never }).rules.arrows, false)
  assert.equal(resolveConfig({ rules: { 'horizontal-rule': true } as never }).rules.hrDivider, true)
  assert.equal(resolveConfig({ rules: { 'emoji-decoration': false } as never }).rules.emojiDecor, false)
  assert.equal(resolveConfig({ rules: { 'inline-header-bullet': true } as never }).rules.inlineHeaderBullets, true)
})

test('config: an always-on rule reports why it cannot be toggled', () => {
  assert.throws(() => resolveConfig({ rules: { 'unicode-bold': false } as never }), /always on/)
  assert.throws(() => resolveConfig({ rules: { 'invisible-unicode': false } as never }), /always on/)
})

test('reveal-shape fires on the tease families and defaults on', () => {
  const hits = [
    'This is the thing everyone gets wrong about queues.',
    'What nobody tells you is that the retry budget is shared.',
    'The part everyone skips is the dead-letter queue.',
    'No one warns you about the cold-start penalty.',
    "What they don't tell you is the quota resets monthly.",
    "That's the secret most people miss.",
  ]
  for (const h of hits) {
    assert.ok(rulesOf(h, NEUTRAL).includes('reveal-shape'), h)
  }
})

test('reveal-shape: a bare people/they subject is ordinary English, not a tease', () => {
  // Every line below was a FINDING before the subject was narrowed to a
  // universal quantifier and "tell" was given its object. On a default-ON
  // rule these are the expensive kind of false positive.
  const clean = [
    'The audit records what people say about the outage.',
    'We logged what they know about the incident.',
    "Ask what they don't know before designing the training.",
    'It is the part people ignore.',
    'That is the thing they get wrong.',
    'The dashboard tells you which shard is hot.',
  ]
  for (const c of clean) {
    assert.equal(lint(c, STRICT).filter((v) => v.rule === 'reveal-shape').length, 0, c)
  }
  // Swapping the bare subject for a universal quantifier restores the tease,
  // and the rule fires again. That contrast IS the rule.
  assert.ok(rulesOf('It is the part everyone ignores.', NEUTRAL).includes('reveal-shape'))
  assert.ok(rulesOf('It is the part everyone skips.', NEUTRAL).includes('reveal-shape'))
})

test('typographic apostrophes match, because that is how models punctuate', () => {
  // U+2019 is one code unit like U+0027, so straightening it before matching
  // preserves every offset. Without it the contraction-bearing rules were
  // blind to exactly the text they most need to read.
  assert.ok(rulesOf('It isn’t a rewrite. It’s a rename.').includes('contrast-slop'))
  assert.ok(rulesOf('You can’t tune this. It’s a hard limit.').includes('contrast-slop'))
  assert.ok(rulesOf('What they don’t tell you is the quota resets.', NEUTRAL).includes('reveal-shape'))
  assert.ok(rulesOf('Here’s why this matters.', NEUTRAL).some((r) => r.includes('banned opener')))
  assert.ok(rulesOf('It’s important to note that this works.', NEUTRAL).some((r) => r.includes('banned phrase')))
  // Offsets survive: the finding still points at the right line.
  const v = lint('ok\n\nIt’s important to note that this works.', NEUTRAL)
  assert.equal(v[0].line, 3)
})

test('banned phrases report once per span when entries nest', () => {
  // The aggressive pack bans bare `unleash`; the defaults ban `unleash the
  // power of`. One span must not read as two problems.
  const rc = resolveConfig({ phrasePacks: ['aggressive'] })
  const hits = lint('Unleash the power of the platform.', NEUTRAL, rc.banned)
  assert.equal(hits.length, 1)
  assert.ok(hits[0].rule.includes('unleash the power of'), 'the longer entry wins the span')
  // Non-overlapping entries still report independently.
  assert.equal(lint('We delve into a seamless tapestry.', NEUTRAL).length, 3)
})

test('reveal-shape leaves ordinary uses of its trigger words alone', () => {
  // Every line below contains a word the patterns key on (part, everyone,
  // most people, nobody, tells). A rule that fires here would be worse than
  // no rule: writers stop reading the output.
  const clean = [
    'The part number is printed on the underside of the case.',
    'Everyone on the team can deploy to staging.',
    'Most people who hit this are running an older client.',
    'The dashboard tells you which shard is hot.',
    'Nobody owns this table, so it never gets vacuumed.',
    'We skipped the part where the cache warms up.',
  ]
  for (const c of clean) {
    assert.equal(lint(c, STRICT).filter((v) => v.rule === 'reveal-shape').length, 0, c)
  }
})

test('reveal-shape reports once per line when families overlap', () => {
  // "the thing everyone gets wrong" matches the tease family AND the
  // "this is the thing <nobody>" family; one span, one finding.
  const v = lint('This is the thing everyone gets wrong.', STRICT)
  assert.equal(v.filter((x) => x.rule === 'reveal-shape').length, 1)
})

test('contrast-slop covers modal negations and past-copula reassertion', () => {
  // Regression: the negation side accepted only is/are/was/were, and the
  // reassertion side only a present copula, so these slipped through.
  assert.ok(rulesOf("The migration wasn't a rewrite. It was a rename.").includes('contrast-slop'))
  assert.ok(rulesOf("You can't tune this. It's a hard limit.").includes('contrast-slop'))
  assert.ok(rulesOf('The scheduler cannot preempt. It is cooperative.').includes('contrast-slop'))
  assert.ok(rulesOf("These aren't warnings. They are errors.").includes('contrast-slop'))
})

test('contrast-slop: boundaries the corpus paid for', () => {
  // Each assertion below is a measured decision, not a guess. Numbers and
  // sample hits live in corpus/REPORT.md.

  // (1) A lexical-auxiliary negation negates an ACTION, and what follows is a
  // new statement rather than a reassertion. Allowing it tripled the rate on
  // human technical prose, so `do/does/did/has/have/had` stay off the left.
  assert.ok(!rulesOf('For most volume types, you do not need to set this field. It is automatic.').includes('contrast-slop'))
  assert.ok(!rulesOf("Kubernetes doesn't prevent you from managing Pods directly. It is possible.").includes('contrast-slop'))
  assert.ok(!rulesOf("The cache doesn't expire. It leaks.").includes('contrast-slop'))

  // (2) A semicolon is not a sentence end. `; that is,` is a discourse
  // marker, and the old boundary class read it as a reassertion.
  assert.ok(!rulesOf("`<main>` doesn't contribute to the outline; that is, unlike other elements.").includes('contrast-slop'))

  // (3) A bare lexical verb after the pronoun is the reassertion SHAPE, but
  // matching any verb there swallows ordinary two-sentence prose.
  assert.ok(!rulesOf("Retries don't help. They amplify the outage.").includes('contrast-slop'))
})

test('phrase packs: opt-in only, and an unknown name throws', () => {
  const line = 'We leverage a comprehensive framework to foster synergy.'
  assert.equal(lint(line, NEUTRAL, resolveConfig({}).banned).length, 0)

  const rc = resolveConfig({ phrasePacks: ['aggressive'] })
  const hits = lint(line, NEUTRAL, rc.banned).map((v) => v.rule)
  for (const p of ['leverage', 'comprehensive', 'foster', 'synergy']) {
    assert.ok(hits.includes(`banned phrase: "${p}"`), p)
  }
  // A pack entry a site legitimately uses is still removable.
  const trimmed = resolveConfig({ phrasePacks: ['aggressive'], bannedPhrases: { remove: ['leverage'] } })
  assert.ok(!trimmed.banned.includes('leverage'))
  assert.ok(trimmed.banned.includes('synergy'))

  assert.throws(() => resolveConfig({ phrasePacks: ['nope'] }), /unknown phrase pack/)
})

test('imported vocabulary is in the defaults, and the tic entries are not', () => {
  for (const p of ['let that sink in', 'imagine a world where', 'best-in-class', 'paradigm shift']) {
    assert.ok(rulesOf(`x ${p} y`, NEUTRAL).includes(`banned phrase: "${p}"`), p)
  }
  // slopster bans /quiet\w*/ and /sharp\w*/; importing those wholesale would
  // fire on any sentence using an ordinary adjective.
  assert.equal(lint('The rollout was quiet and the error budget sharp.', STRICT).length, 0)
})

test('clean prose is clean', () => {
  assert.equal(lint('How to trim silence from a video', STRICT).length, 0)
})
