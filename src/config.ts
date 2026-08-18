// Per-project configuration: how a site expresses its VOICE to the linter.
// The engine owns the mechanisms; each repo owns what applies to it via an
// `antislop.config.json` next to its content. The linter is the enforcement
// half of a voice (what never ships); the generative half (what to write,
// tone, style guides) belongs in each site's own docs and prompts.
import { NEUTRAL, STRICT, BANNED_OPENERS, DEFAULT_BANNED_PHRASES, type RuleSet } from './index.js'

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

export function resolveConfig(cfg: AntislopConfig = {}): ResolvedConfig {
  const base = cfg.profile === 'strict' ? STRICT : NEUTRAL
  const rules: RuleSet = { ...base, ...(cfg.rules ?? {}) }

  let banned: string[]
  if (Array.isArray(cfg.bannedPhrases)) {
    banned = cfg.bannedPhrases.map((p) => p.toLowerCase())
  } else {
    const remove = new Set((cfg.bannedPhrases?.remove ?? []).map((p) => p.toLowerCase()))
    banned = [
      ...DEFAULT_BANNED_PHRASES.filter((p) => !remove.has(p)),
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
