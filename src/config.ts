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
  type RuleSet,
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
   *  trailingCta: exempt a "→" ending a line or a link text. */
  arrowExemptions?: { trailingCta?: boolean }
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

export function resolveConfig(cfg: AntislopConfig = {}): ResolvedConfig {
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
  }
}
