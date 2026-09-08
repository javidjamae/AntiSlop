// Invariants over what the package SHIPS, derived from the data rather than
// hand-listed. A test that restates a list cannot catch the list changing; a
// test that quantifies over it can.
//
// Every case here answers a question that was asked too late at least once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lint,
  straighten,
  severityFamily,
  severityOf,
  DEFAULT_BANNED_PHRASES,
  DEFAULT_SEVERITY,
  SEVERITY_RANK,
  BANNED_OPENERS,
  PHRASE_PACKS,
  NEUTRAL,
  STRICT,
  RULE_ID_TO_KEY,
  resolveConfig,
  toLintExtras,
  type Severity,
} from './index.js'
import { RULE_TRIGGERS, CUSTOM_PROBE } from './fixtures.js'

const strictProbe = () =>
  resolveConfig({ profile: 'strict', customRules: [CUSTOM_PROBE] })

const familiesFiredBy = (text: string) => {
  const rc = strictProbe()
  return new Set(lint(text, rc.rules, rc.banned, toLintExtras(rc)).map((v) => severityFamily(v.rule)))
}

// --- the shipped phrase list ------------------------------------------------

test('every shipped phrase fires, in either apostrophe spelling', () => {
  // The question nobody asked before v0.5.0 dropped four smart-quoted entries.
  // Quantified over the list, it answers itself for every future edit: matching
  // straightens both sides, so a phrase must fire whichever way it is typed.
  for (const phrase of DEFAULT_BANNED_PHRASES) {
    const straightHit = lint(`We say ${phrase} here.`, NEUTRAL)
    assert.ok(
      straightHit.some((v) => v.rule.includes(phrase)),
      `"${phrase}" does not fire on its own spelling`
    )
    const curly = phrase.replace(/'/g, '’')
    if (curly === phrase) continue
    assert.ok(
      lint(`We say ${curly} here.`, NEUTRAL).some((v) => v.rule.includes(phrase)),
      `"${phrase}" does not fire when typed with a smart apostrophe`
    )
  }
})

test('the shipped lists are in one normalized form', () => {
  // The form the whole matching path assumes. A twin, a stray capital or a
  // padded entry each make a `remove` look broken rather than fail loudly.
  for (const [name, list] of [
    ['DEFAULT_BANNED_PHRASES', DEFAULT_BANNED_PHRASES],
    ['BANNED_OPENERS', BANNED_OPENERS],
    ...Object.entries(PHRASE_PACKS),
  ] as [string, string[]][]) {
    for (const p of list) {
      assert.equal(p, p.toLowerCase(), `${name}: "${p}" is not lowercase`)
      assert.equal(p, p.trim(), `${name}: "${p}" has surrounding whitespace`)
      assert.ok(p.length > 0, `${name}: empty entry`)
      assert.equal(straighten(p), p, `${name}: "${p}" carries a smart apostrophe`)
    }
    assert.equal(new Set(list).size, list.length, `${name} has duplicate entries`)
    assert.equal(
      new Set(list.map(straighten)).size,
      list.length,
      `${name} has entries that collide once straightened`
    )
  }
})

test('a phrase pack adds to the floor without colliding with it', () => {
  // A pack entry already in the floor would be dead config: opting into the
  // pack would change nothing while appearing to.
  for (const [name, pack] of Object.entries(PHRASE_PACKS)) {
    const overlap = pack.filter((p) => DEFAULT_BANNED_PHRASES.includes(p))
    assert.deepEqual(overlap, [], `pack "${name}" repeats floor entries: ${overlap.join(', ')}`)
  }
})

// --- the rule table ---------------------------------------------------------

test('every rule that can fire has a DEFAULT_SEVERITY entry', () => {
  // A missing entry does not break linting — severityOf falls back to error —
  // but it makes the config layer reject a severity for a rule that plainly
  // exists, because DEFAULT_SEVERITY is what it validates names against.
  for (const [rule, text] of Object.entries(RULE_TRIGGERS)) {
    assert.ok(familiesFiredBy(text).has(rule), `trigger for "${rule}" no longer fires it`)
    assert.ok(Object.hasOwn(DEFAULT_SEVERITY, rule), `"${rule}" fires but has no severity entry`)
  }
})

test('every DEFAULT_SEVERITY entry is a rule that can actually fire', () => {
  // The other direction. An entry for a rule that no longer exists is a name
  // the config layer accepts and nothing honors.
  const reachable = new Set(Object.keys(RULE_TRIGGERS))
  for (const rule of Object.keys(DEFAULT_SEVERITY)) {
    assert.ok(reachable.has(rule), `"${rule}" has a severity but no fixture proves it can fire`)
  }
})

test('every severity is a level the CLI can rank and the config can accept', () => {
  for (const [rule, sev] of Object.entries(DEFAULT_SEVERITY)) {
    assert.ok(Object.hasOwn(SEVERITY_RANK, sev), `${rule}: "${sev}" has no rank`)
    assert.doesNotThrow(
      () => resolveConfig({ severities: { [rule]: sev } }),
      `${rule}: config rejects its own default severity`
    )
  }
})

test('both spellings of every toggleable rule reach the same rule', () => {
  // Findings print kebab ids; config takes either. A rule whose two spellings
  // disagree gives a config that resolves cleanly and silences nothing.
  for (const [id, key] of Object.entries(RULE_ID_TO_KEY)) {
    const byId = resolveConfig({ rules: { [id]: false } as never })
    const byKey = resolveConfig({ rules: { [key]: false } })
    assert.deepEqual(byId.rules, byKey.rules, `"${id}" and "${key}" resolve differently`)
  }
})

test('a rule that is off cannot produce a finding, whatever its severity', () => {
  // Severity and the on/off toggle are independent axes. Demoting a rule must
  // not quietly enable it, and disabling one must not be overridden by a
  // severity entry naming it.
  for (const [id, key] of Object.entries(RULE_ID_TO_KEY)) {
    const trigger = RULE_TRIGGERS[id]
    if (!trigger) continue
    const rc = resolveConfig({
      profile: 'strict',
      rules: { [key]: false },
      severities: { [id]: 'info' },
    })
    const fired = new Set(lint(trigger, rc.rules, rc.banned, toLintExtras(rc)).map((v) => severityFamily(v.rule)))
    assert.ok(!fired.has(id), `"${id}" fired while switched off`)
  }
})

test('severityOf agrees with what lint stamps on the finding', () => {
  // Two code paths read the same table. A host scoring findings trusts that
  // they cannot disagree.
  const overrides: Record<string, Severity> = { 'em-dash': 'info', 'banned-phrase': 'warn' }
  const rc = resolveConfig({ profile: 'strict', customRules: [CUSTOM_PROBE], severities: overrides })
  for (const text of Object.values(RULE_TRIGGERS)) {
    for (const v of lint(text, rc.rules, rc.banned, toLintExtras(rc))) {
      assert.equal(v.severity, severityOf(v.rule, rc.severities), `${v.rule} stamped ${v.severity}`)
    }
  }
})

test('every profile is a complete RuleSet, so no rule is undefined by omission', () => {
  const keys = Object.keys(NEUTRAL).sort()
  assert.deepEqual(Object.keys(STRICT).sort(), keys, 'STRICT and NEUTRAL disagree on which rules exist')
  for (const [name, profile] of [['NEUTRAL', NEUTRAL], ['STRICT', STRICT]] as const) {
    for (const [key, on] of Object.entries(profile)) {
      assert.equal(typeof on, 'boolean', `${name}.${key} is not a boolean`)
    }
  }
})
