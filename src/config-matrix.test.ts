// Coverage of the config surface, which had none.
//
// Worth stating plainly, because it decided what this file contains: every
// config bug found in the v0.5.0 cycle lived here, and NONE of them were
// reachable by a corpus sweep. `$schema` rejected, `severity` for `severities`
// silently ignored, `remvoe` silently ignored, a blank phrase entry matching
// every line, a `remove` that took only one apostrophe spelling, a custom
// pattern that could never match. A corpus measures how rules behave on prose.
// It says nothing about how the tool behaves on the file that configures it.
//
// The organizing principle: for each option, prove it TAKES EFFECT, and prove a
// plausible typo of it is REFUSED. The failure this project keeps refusing is
// config that resolves cleanly and quietly does nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lint, severityFamily, NEUTRAL } from './index.js'
import { resolveConfig, toLintExtras, type AntislopConfig } from './config.js'
import { RULE_TRIGGERS, CUSTOM_PROBE } from './fixtures.js'

const firesUnder = (cfg: AntislopConfig, text: string) => {
  const rc = resolveConfig(cfg)
  return new Set(lint(text, rc.rules, rc.banned, toLintExtras(rc)).map((v) => severityFamily(v.rule)))
}

// --- every option takes effect ---------------------------------------------

test('profile selects the base, and an override beats it', () => {
  assert.ok(!firesUnder({}, RULE_TRIGGERS['em-dash']!).has('em-dash'))
  assert.ok(firesUnder({ profile: 'strict' }, RULE_TRIGGERS['em-dash']!).has('em-dash'))
  assert.ok(!firesUnder({ profile: 'strict', rules: { emDash: false } }, RULE_TRIGGERS['em-dash']!).has('em-dash'))
  assert.ok(firesUnder({ rules: { emDash: true } }, RULE_TRIGGERS['em-dash']!).has('em-dash'))
})

test('bannedPhrases: array replaces, add extends, remove subtracts', () => {
  assert.ok(firesUnder({ bannedPhrases: ['flurgle'] }, 'a flurgle appears').size > 0)
  // and the replaced defaults are gone
  assert.equal(firesUnder({ bannedPhrases: ['flurgle'] }, 'We delve into it.').size, 0)
  assert.ok(firesUnder({ bannedPhrases: { add: ['flurgle'] } }, 'a flurgle appears').has('banned-phrase'))
  assert.ok(firesUnder({ bannedPhrases: { add: ['flurgle'] } }, 'We delve into it.').has('banned-phrase'))
  assert.ok(!firesUnder({ bannedPhrases: { remove: ['delve'] } }, 'We delve into it.').has('banned-phrase'))
})

test('openers: add extends, remove subtracts', () => {
  assert.ok(!firesUnder({ openers: { remove: ["here's why"] } }, "Here's why this matters.").has('banned-opener'))
  assert.ok(firesUnder({ openers: { add: ['so anyway'] } }, 'So anyway this happened.').has('banned-opener'))
})

test('phrasePacks appends, and resolves before remove so one entry can be dropped', () => {
  const packed = resolveConfig({ phrasePacks: ['aggressive'] })
  assert.ok(packed.banned.length > resolveConfig({}).banned.length)
  const word = packed.banned.find((p) => !resolveConfig({}).banned.includes(p))!
  const trimmed = resolveConfig({ phrasePacks: ['aggressive'], bannedPhrases: { remove: [word] } })
  assert.ok(!trimmed.banned.includes(word), `remove did not reach pack entry "${word}"`)
})

test('customRules fire as custom:<id>, with flags honored', () => {
  assert.ok(firesUnder({ customRules: [CUSTOM_PROBE] }, 'a zzprobezz here').has('custom'))
  // default flag is `i`
  assert.ok(firesUnder({ customRules: [CUSTOM_PROBE] }, 'a ZZPROBEZZ here').has('custom'))
  // an explicit case-sensitive flag set is respected
  assert.ok(
    !firesUnder({ customRules: [{ ...CUSTOM_PROBE, flags: '' }] }, 'a ZZPROBEZZ here').has('custom')
  )
})

test('arrowExemptions.trailingCta is opt-in and off by default', () => {
  const cta = 'Install from the App Store →'
  assert.ok(firesUnder({ profile: 'strict' }, cta).has('arrow-symbol'))
  assert.ok(!firesUnder({ profile: 'strict', arrowExemptions: { trailingCta: true } }, cta).has('arrow-symbol'))
})

test('severities reach every rule, in both spellings and all three levels', () => {
  for (const rule of Object.keys(RULE_TRIGGERS)) {
    for (const level of ['error', 'warn', 'info'] as const) {
      const rc = resolveConfig({ profile: 'strict', customRules: [CUSTOM_PROBE], severities: { [rule]: level } })
      const hits = lint(RULE_TRIGGERS[rule]!, rc.rules, rc.banned, toLintExtras(rc)).filter(
        (v) => severityFamily(v.rule) === rule
      )
      assert.ok(hits.length > 0, `${rule} stopped firing under severity ${level}`)
      for (const h of hits) assert.equal(h.severity, level, `${rule} at ${level}`)
    }
  }
})

// --- and every plausible typo of it is refused ------------------------------

test('a typo of any documented top-level key is refused', () => {
  const typos = {
    profiel: 'neutral',
    rulez: {},
    bannedPhrase: [],
    phrasePack: [],
    opener: {},
    customRule: [],
    arrowExemption: {},
    severity: {},
  }
  for (const [key, value] of Object.entries(typos)) {
    assert.throws(
      () => resolveConfig({ [key]: value } as never),
      new RegExp(`unknown key "${key}"`),
      `"${key}" was accepted`
    )
  }
})

test('a typo inside an option is refused, at every level that takes one', () => {
  assert.throws(() => resolveConfig({ bannedPhrases: { remvoe: [] } } as never), /unknown key "remvoe" in bannedPhrases/)
  assert.throws(() => resolveConfig({ openers: { ad: [] } } as never), /unknown key "ad" in openers/)
  assert.throws(() => resolveConfig({ arrowExemptions: { trailingCTA: true } } as never), /unknown key "trailingCTA"/)
  assert.throws(() => resolveConfig({ rules: { emDashh: true } } as never), /unknown rule "emDashh"/)
  assert.throws(() => resolveConfig({ severities: { 'em-dashh': 'info' } } as never), /unknown rule "em-dashh"/)
  assert.throws(() => resolveConfig({ phrasePacks: ['agressive'] }), /unknown phrase pack "agressive"/)
  assert.throws(() => resolveConfig({ severities: { 'em-dash': 'critical' } } as never), /must be one of/)
})

test('an always-on rule refuses a toggle but accepts a severity', () => {
  for (const rule of ['unicode-bold', 'engagement-bait', 'invisible-unicode', 'banned-phrase']) {
    assert.throws(() => resolveConfig({ rules: { [rule]: false } } as never), /always on/, `${rule} toggle`)
    assert.doesNotThrow(() => resolveConfig({ severities: { [rule]: 'info' } }), `${rule} severity`)
  }
})

test('editor and comment keys are accepted at every level that validates keys', () => {
  assert.doesNotThrow(() =>
    resolveConfig({
      $schema: 'https://example.com/s.json',
      '//': 'house style',
      '// rules': 'why these',
      rules: { '// emDash': 'kept on', emDash: true },
      severities: { '// em-dash': 'advisory', 'em-dash': 'info' },
    } as never)
  )
})

test('options compose without one silently cancelling another', () => {
  // Each option was proven in isolation above. This is the combination a real
  // repo writes, where a bug shows up as one setting quietly losing.
  const cfg: AntislopConfig = {
    profile: 'strict',
    rules: { emDash: false },
    bannedPhrases: { add: ['flurgle'], remove: ['delve'] },
    phrasePacks: ['aggressive'],
    openers: { add: ['so anyway'], remove: ["here's why"] },
    customRules: [CUSTOM_PROBE],
    arrowExemptions: { trailingCta: true },
    severities: { 'banned-phrase': 'info', custom: 'warn' },
  }
  assert.ok(!firesUnder(cfg, RULE_TRIGGERS['em-dash']!).has('em-dash'), 'rules override lost')
  assert.ok(firesUnder(cfg, 'a flurgle appears').has('banned-phrase'), 'phrase add lost')
  assert.ok(!firesUnder(cfg, 'We delve into it.').has('banned-phrase'), 'phrase remove lost')
  assert.ok(firesUnder(cfg, 'So anyway this happened.').has('banned-opener'), 'opener add lost')
  assert.ok(!firesUnder(cfg, "Here's why this matters.").has('banned-opener'), 'opener remove lost')
  assert.ok(firesUnder(cfg, 'a zzprobezz here').has('custom'), 'custom rule lost')
  assert.ok(!firesUnder(cfg, 'Install from the App Store →').has('arrow-symbol'), 'arrow exemption lost')

  const rc = resolveConfig(cfg)
  const phraseHit = lint('a flurgle appears', rc.rules, rc.banned, toLintExtras(rc)).find(
    (v) => severityFamily(v.rule) === 'banned-phrase'
  )
  assert.equal(phraseHit?.severity, 'info', 'severity override lost')
})

test('an empty config is the documented default, not an error', () => {
  assert.deepEqual(resolveConfig({}).rules, NEUTRAL)
  assert.doesNotThrow(() => resolveConfig())
})
