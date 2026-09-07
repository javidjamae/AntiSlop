// Per-project configuration: how a site expresses its VOICE to the linter.
// The engine owns the mechanisms; each repo owns what applies to it via an
// `antislop.config.json` next to its content. The linter is the enforcement
// half of a voice (what never ships); the generative half (what to write,
// tone, style guides) belongs in each site's own docs and prompts.
import {
  NEUTRAL,
  STRICT,
  BANNED_OPENERS,
  DEFAULT_BANNED_PHRASES,
  PHRASE_PACKS,
  DEFAULT_SEVERITY,
  type RuleSet,
  type Severity,
  type LintExtras,
} from './index.js'

export interface CustomRule {
  /** Reported as `custom: <id>`. */
  id: string
  /** JavaScript regex source, matched per line (skip mask honored). */
  pattern: string
  /** Regex flags; `i` if omitted. */
  flags?: string
  suggestion?: string
}

export interface AntislopConfig {
  /** Base profile the overrides start from. Default: "neutral". */
  profile?: 'neutral' | 'strict'
  /** Per-rule overrides on top of the profile. */
  rules?: Partial<RuleSet>
  /** An array REPLACES the default phrase list wholesale; the object form
   *  edits it — `add` for site-specific voice bans, `remove` for defaults the
   *  site legitimately uses (an API really named "robust", say). */
  bannedPhrases?: string[] | { add?: string[]; remove?: string[] }
  /** Named vocabulary packs to append, e.g. ["aggressive"]. Opt-in: a pack
   *  holds ordinary professional English that LLMs overuse, which is a voice
   *  choice per repo rather than a machine-authorship tell. An unknown pack
   *  name throws, same as an unknown rule key. */
  phrasePacks?: string[]
  /** Same shape for the sentence-opener list. */
  openers?: { add?: string[]; remove?: string[] }
  /** Site-specific regex rules. */
  customRules?: CustomRule[]
  /** Site arrow conventions beyond the universal core exemptions
   *  (breadcrumbs, pipelines, leading back-links are always exempt).
   *  trailingCta: exempt a "→" ending a link text or a line. */
  arrowExemptions?: { trailingCta?: boolean }
  /** Per-rule severity overrides: "error" | "warn" | "info". Accepts either
   *  spelling of a rule name, same as `rules`. A rule set below "error" still
   *  RUNS and still reports; it just stops failing the run under the default
   *  --fail-on=error. Unlike `rules`, always-on rules accept a severity: they
   *  cannot be silenced, but a site may choose to treat one as advisory. */
  severities?: Record<string, Severity>
}

export interface CompiledCustomRule {
  id: string
  re: RegExp
  suggestion?: string
}

export interface ResolvedConfig {
  rules: RuleSet
  banned: string[]
  openers: string[]
  customRules: CompiledCustomRule[]
  arrows: { trailingCta: boolean }
  /** Keyed by rule ID as printed in findings; empty when nothing is overridden. */
  severities: Record<string, Severity>
}

/**
 * Kebab rule IDs (what findings print) -> camelCase RuleSet keys (what config
 * takes). Several are NOT a mechanical conversion — `arrow-symbol` is `arrows`,
 * `horizontal-rule` is `hrDivider`, `inline-header-bullet` is plural — so a
 * reader cannot derive the key from CLI output. Both spellings are accepted.
 */
export const RULE_ID_TO_KEY: Record<string, keyof RuleSet> = {
  'em-dash': 'emDash',
  ellipsis: 'ellipsis',
  'arrow-symbol': 'arrows',
  'horizontal-rule': 'hrDivider',
  'banned-opener': 'bannedOpeners',
  'inline-header-bullet': 'inlineHeaderBullets',
  'emoji-decoration': 'emojiDecor',
  'bold-overuse': 'boldOveruse',
  'contrast-slop': 'contrastSlop',
  'reversed-antithesis': 'reversedAntithesis',
  'heading-dependent-opener': 'headingDependentOpener',
  'demonstrative-heading': 'demonstrativeHeading',
  'reveal-shape': 'revealShape',
}

/** Rules with no toggle: they have no legitimate prose use and always run. */
const ALWAYS_ON = new Set(['unicode-bold', 'engagement-bait', 'banned-phrase', 'invisible-unicode'])

/**
 * Resolve a `rules` override map, accepting either spelling.
 *
 * An unrecognized key THROWS rather than being ignored. Silently accepting one
 * is the worst failure mode available here: the config looks applied, the exit
 * code is unchanged, and a rule the author believes they turned off quietly
 * stays on.
 */
function normalizeRuleOverrides(raw: Partial<RuleSet> | Record<string, boolean>): Partial<RuleSet> {
  const out: Partial<RuleSet> = {}
  const valid = new Set(Object.keys(NEUTRAL))
  for (const [key, value] of Object.entries(raw)) {
    if (valid.has(key)) {
      out[key as keyof RuleSet] = value as boolean
      continue
    }
    const aliased = RULE_ID_TO_KEY[key]
    if (aliased) {
      out[aliased] = value as boolean
      continue
    }
    if (ALWAYS_ON.has(key)) {
      throw new Error(
        `antislop config: "${key}" is always on and cannot be toggled (it has no legitimate prose use).`
      )
    }
    throw new Error(
      `antislop config: unknown rule "${key}". Valid keys: ${Object.keys(NEUTRAL).sort().join(', ')}. ` +
        `Rule IDs as printed in findings also work (e.g. "reversed-antithesis" for "reversedAntithesis").`
    )
  }
  return out
}

// Null-prototype, so an inherited member name ("toString", "constructor") is a
// miss rather than a truthy hit that bypasses the unknown-rule throw below.
const KEY_TO_RULE_ID: Record<string, string> = Object.assign(
  Object.create(null),
  Object.fromEntries(Object.entries(RULE_ID_TO_KEY).map(([id, key]) => [key, id]))
)
const VALID_SEVERITIES = new Set(['error', 'warn', 'info'])

/** Findings print a custom rule as `custom: <id>` WITH a space. Accept the
 *  spaced and unspaced spellings and canonicalize to what severityOf matches,
 *  otherwise the override resolves cleanly and silently never fires. */
const CUSTOM_ADDRESS = /^custom:\s*(.+)$/

/**
 * Resolve a `severities` map to rule IDs. Same contract as the rule overrides:
 * an unrecognized rule name or an invalid level THROWS. A typo that is silently
 * ignored produces a config that looks applied and a rule that quietly keeps
 * its old weight, which is exactly the failure this project refuses elsewhere.
 */
function normalizeSeverities(
  raw: Record<string, string>,
  customRules: CustomRule[]
): Record<string, Severity> {
  const out: Record<string, Severity> = {}
  const customIds = new Set(customRules.map((r) => r.id))
  for (const [key, value] of Object.entries(raw)) {
    if (!VALID_SEVERITIES.has(value)) {
      throw new Error(
        `antislop config: severity for "${key}" must be one of error, warn, info (got ${JSON.stringify(value)}).`
      )
    }
    // A single custom rule, addressed by id. Canonicalized to the spaced form
    // findings actually print, and checked against the rules that exist —
    // a typo here is the "looks applied, does nothing" failure, not a no-op.
    const custom = CUSTOM_ADDRESS.exec(key)
    if (custom) {
      const id = custom[1].trim()
      if (!customIds.has(id)) {
        throw new Error(
          `antislop config: severities names custom rule "${id}", which is not in customRules. ` +
            `Defined: ${customIds.size ? [...customIds].sort().join(', ') : '(none)'}.`
        )
      }
      out[`custom: ${id}`] = value as Severity
      continue
    }
    // Otherwise the camelCase config key or the kebab rule ID. Object.hasOwn so
    // an inherited member name cannot pose as a rule.
    const id = Object.hasOwn(KEY_TO_RULE_ID, key)
      ? KEY_TO_RULE_ID[key]
      : Object.hasOwn(DEFAULT_SEVERITY, key)
        ? key
        : undefined
    if (!id) {
      throw new Error(
        `antislop config: unknown rule "${key}" in severities. Valid names: ` +
          `${Object.keys(DEFAULT_SEVERITY).sort().join(', ')}, or a camelCase rule key, ` +
          `or "custom: <id>" for one custom rule.`
      )
    }
    out[id] = value as Severity
  }
  return out
}

/**
 * The `extras` argument `lint()` wants, built from a resolved config.
 *
 * This mapping used to be hand-copied at the call site, which meant every field
 * added to ResolvedConfig had to be remembered there or it was silently dropped
 * — a config that resolves correctly and then does nothing, with no error.
 *
 * The return type is `Required<LintExtras>`, deliberately: it is the type of
 * the argument `lint()` actually reads, so the compiler errors the moment
 * LintExtras grows a field this function does not supply. Typing it against
 * ResolvedConfig instead only restated the fields already listed below, which
 * is exactly the hand-copying this is meant to prevent.
 */
export function toLintExtras(rc: ResolvedConfig): Required<LintExtras> {
  return {
    openers: rc.openers,
    customRules: rc.customRules,
    arrows: rc.arrows,
    severities: rc.severities,
  }
}

/** Every key `AntislopConfig` understands. An unknown top-level key is a typo,
 *  and a typo that resolves to nothing is the worst kind: `"severity"` for
 *  `"severities"` leaves the run gating while the author believes the rule was
 *  made advisory. The same reasoning the rule-name check already applies inside
 *  `severities`, applied one level up. */
const KNOWN_CONFIG_KEYS = [
  'profile',
  'rules',
  'bannedPhrases',
  'phrasePacks',
  'openers',
  'customRules',
  'arrowExemptions',
  'severities',
] as const

export function resolveConfig(cfg: AntislopConfig = {}): ResolvedConfig {
  for (const key of Object.keys(cfg)) {
    if (!(KNOWN_CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `antislop config: unknown key "${key}". Valid keys: ${[...KNOWN_CONFIG_KEYS].sort().join(', ')}.`
      )
    }
  }
  const base = cfg.profile === 'strict' ? STRICT : NEUTRAL
  const rules: RuleSet = { ...base, ...normalizeRuleOverrides(cfg.rules ?? {}) }

  // Packs resolve BEFORE `bannedPhrases.remove` applies, so a site can opt
  // into a pack and drop a single entry it legitimately uses.
  const packed: string[] = []
  for (const name of cfg.phrasePacks ?? []) {
    const pack = PHRASE_PACKS[name]
    if (!pack) {
      throw new Error(
        `antislop config: unknown phrase pack "${name}". Valid packs: ${Object.keys(PHRASE_PACKS).sort().join(', ')}.`
      )
    }
    packed.push(...pack)
  }

  let banned: string[]
  if (Array.isArray(cfg.bannedPhrases)) {
    banned = [...cfg.bannedPhrases.map((p) => p.toLowerCase()), ...packed]
  } else {
    const remove = new Set((cfg.bannedPhrases?.remove ?? []).map((p) => p.toLowerCase()))
    banned = [
      ...DEFAULT_BANNED_PHRASES.filter((p) => !remove.has(p)),
      ...packed.filter((p) => !remove.has(p)),
      ...(cfg.bannedPhrases?.add ?? []).map((p) => p.toLowerCase()),
    ]
  }

  const removeOpeners = new Set((cfg.openers?.remove ?? []).map((p) => p.toLowerCase()))
  const openers = [
    ...BANNED_OPENERS.filter((p) => !removeOpeners.has(p)),
    ...(cfg.openers?.add ?? []).map((p) => p.toLowerCase()),
  ]

  const customRules: CompiledCustomRule[] = (cfg.customRules ?? []).map((r) => ({
    id: r.id,
    re: new RegExp(r.pattern, r.flags ?? 'i'),
    suggestion: r.suggestion,
  }))

  return {
    rules,
    banned,
    openers,
    customRules,
    arrows: { trailingCta: cfg.arrowExemptions?.trailingCta ?? false },
    severities: normalizeSeverities(cfg.severities ?? {}, cfg.customRules ?? []),
  }
}
