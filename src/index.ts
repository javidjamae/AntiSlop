// antislop — a deterministic linter for the mechanical tells of AI-generated
// prose. Pure functions over strings: no I/O, no network, no state.
//
// Scope note: only HIGH-PRECISION, regexable tells live here. Judgment-tier
// patterns (rule-of-three cadence, significance inflation beyond fixed
// phrases, ambiguous pronoun referents in running prose) cannot be separated
// from legitimate craft by a regex and are deliberately out of scope — see
// RULES.md for the explicit list.
//
// Several rules and the default phrase list draw on Wikipedia's "Signs of AI
// writing" and blader/humanizer (MIT).

/** How much a finding matters. `error` fails the run, `warn` and `info` report
 *  without failing (see the CLI's --fail-on). Absent means `error`: severity is
 *  optional on the type so existing consumers that CONSTRUCT a Violation to
 *  hand to format() keep type-checking, while lint() always populates it. */
export type Severity = 'error' | 'warn' | 'info'

/** Ascending, so a threshold comparison is a number comparison. */
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 }

export interface Violation {
  line: number
  rule: string
  excerpt: string
  suggestion?: string
  /** Absent means `error`. */
  severity?: Severity
}

/**
 * Per-rule default severity. EVERY rule that exists today is `error`, which is
 * what keeps this change additive: exit codes are byte-identical for every
 * existing config. A rule enters below `error` only when it is deliberately
 * advisory — a real tell that needs a human read in context and cannot carry a
 * measured precision number, where failing a build would teach people to
 * ignore the linter.
 *
 * Keyed by rule ID as printed in findings. The dynamic families use their
 * collective key: `banned-opener`, `banned-phrase`, `custom`.
 */
export const DEFAULT_SEVERITY: Record<string, Severity> = Object.assign(Object.create(null), {
  'unicode-bold': 'error',
  'engagement-bait': 'error',
  'invisible-unicode': 'error',
  'em-dash': 'error',
  ellipsis: 'error',
  'arrow-symbol': 'error',
  'horizontal-rule': 'error',
  'contrast-slop': 'error',
  'reversed-antithesis': 'error',
  'inline-header-bullet': 'error',
  'emoji-decoration': 'error',
  'bold-overuse': 'error',
  'heading-dependent-opener': 'error',
  'demonstrative-heading': 'error',
  'reveal-shape': 'error',
  'banned-opener': 'error',
  'banned-phrase': 'error',
  custom: 'error',
  // Null prototype, matching KEY_TO_RULE_ID in config.ts and for the same
  // reason: an inherited member name must be a MISS, not a truthy hit. A rule
  // ID colliding with an Object.prototype member would otherwise resolve to a
  // function, and SEVERITY_RANK[thatFunction] is undefined, so the comparison
  // in the CLI would be false and the finding would silently never gate.
})

/**
 * The family a printed rule ID belongs to, for severity lookup. Three rules
 * report a per-instance ID (`banned opener: "here's why"`, `custom: my-rule`),
 * so an exact-match table would never reach them.
 */
export function severityFamily(rule: string): string {
  if (rule.startsWith('banned opener:')) return 'banned-opener'
  if (rule.startsWith('banned phrase:')) return 'banned-phrase'
  if (rule.startsWith('custom:')) return 'custom'
  return rule
}

/** Resolve a printed rule ID to its severity. Overrides beat defaults; a
 *  custom rule may be addressed individually (`custom: my-rule`) or as a
 *  family (`custom`), individual first. */
export function severityOf(rule: string, overrides: Record<string, Severity> = {}): Severity {
  const family = severityFamily(rule)
  return overrides[rule] ?? overrides[family] ?? DEFAULT_SEVERITY[family] ?? 'error'
}

export interface RuleSet {
  emDash: boolean
  ellipsis: boolean
  arrows: boolean
  hrDivider: boolean
  bannedOpeners: boolean
  inlineHeaderBullets: boolean
  emojiDecor: boolean
  boldOveruse: boolean
  /** Forward contrast flourish: negation immediately reasserted ("It's not
   *  luck. It's process.") or negation + dramatic consequence clause. */
  contrastSlop: boolean
  /** Reversed contrast flourish: a trailing ", not X" / ", never X" closing a
   *  clause. Most hits on clean prose are content-bearing — apply the
   *  delete-the-contrast test to each hit; never bulk-fix. */
  reversedAntithesis: boolean
  /** A section whose first sentence opens with a referring word whose only
   *  antecedent is the heading ("This is where..." under a heading). */
  headingDependentOpener: boolean
  /** Non-question H2/H3 headings ending on a bare it/this/that. */
  demonstrativeHeading: boolean
  /** The reveal shape: "what nobody tells you", "the part everyone skips".
   *  Teases the point instead of stating it, and casts the reader as the one
   *  getting it wrong. Near-zero legitimate use, so it defaults on. */
  revealShape: boolean
}

/** Conservative defaults: rules that false-positive legitimate human writing
 *  (em-dash, ellipsis, hr dividers, contrast rules) are off. */
export const NEUTRAL: RuleSet = {
  emDash: false,
  ellipsis: false,
  arrows: true,
  hrDivider: false,
  bannedOpeners: true,
  inlineHeaderBullets: false,
  emojiDecor: true,
  boldOveruse: true,
  contrastSlop: false,
  reversedAntithesis: false,
  headingDependentOpener: true,
  demonstrativeHeading: true,
  revealShape: true,
}

/** Everything on. Warn-tier mindset: read each hit; a strict profile is for
 *  surfaces where any tell is worth a human look, not for auto-fixing. */
export const STRICT: RuleSet = {
  emDash: true,
  ellipsis: true,
  arrows: true,
  hrDivider: true,
  bannedOpeners: true,
  inlineHeaderBullets: true,
  emojiDecor: true,
  boldOveruse: true,
  contrastSlop: true,
  reversedAntithesis: true,
  headingDependentOpener: true,
  demonstrativeHeading: true,
  revealShape: true,
}

// Overused AI openers — matched at line start OR after ". ", so they're caught
// mid-paragraph too.
export const BANNED_OPENERS = [
  "here's why",
  "here's how",
  "here's what",
  "here's the thing",
  "let's dive in",
  "let's break it down",
  "let's unpack",
  "let's explore",
  'without further ado',
  'in this article',
  'in this post',
]

/**
 * Fold the typographic apostrophe to the ASCII one. U+2019 is ONE code unit,
 * same as U+0027, so this is index-preserving: every offset, mask position and
 * excerpt computed on the result stays valid against the original.
 *
 * Exported because matching and CONFIGURING have to agree. `lint()` straightens
 * both the text and the phrase list, so a config that removes a phrase must
 * straighten both sides too, or the removal silently fails to take: the curly
 * twin survives and keeps firing on text the author believed they had exempted.
 */
export const straighten = (s: string): string => s.replace(/\u2019/g, "'")

/**
 * Drop a leading byte-order mark.
 *
 * A BOM is an encoding marker, not content, and Windows editors and a good many
 * export pipelines emit one. Left in place it sits in front of the first
 * character of line 1, so `## Heading` stops matching `^##` and every rule
 * anchored to the start of that line goes quiet. A document that opens with a
 * heading, which is most documents, silently loses the heading rules on it.
 *
 * `invisible-unicode` deliberately does not report a BOM at file start, so
 * nothing else was catching this either. Only the leading one is dropped: a BOM
 * in the middle of a document IS an artifact worth reporting, and still is.
 */
export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/**
 * Fold CRLF (and a lone CR) to LF.
 *
 * Not cosmetic, and not only about splitting lines. Several patterns are
 * bounded character classes — `reversed-antithesis` matches `[^,;:.!?]{2,70}`,
 * `contrast-slop` several more — and a stray `\r` is a member of every one of
 * them. It both satisfies the minimum length and consumes a slot against the
 * maximum, so the SAME prose produces different findings depending on which
 * editor saved it:
 *
 *     lint('(a JSON number, not a\nstring)')     -> no finding
 *     lint('(a JSON number, not a\r\nstring)')   -> reversed-antithesis
 *
 * That is real on this repo's own RULES.md, which lints clean as committed and
 * gains a finding if saved with Windows line endings. The two structural rules
 * already folded CRLF; `lint()` did not, so the rules it owns were the ones
 * exposed.
 */
export const normalizeEol = (s: string): string => s.replace(/\r\n?/g, '\n')

export const DEFAULT_BANNED_PHRASES = [
  'the reality is', 'the truth is',
  "i'll be honest", 'frankly', 'frankly speaking',
  'game-changer', 'game changer', 'cutting-edge', 'seamless', 'seamlessly', 'robust',
  "in today's landscape", "in today's world", "in today's environment",
  'straightforward', "it's worth noting", 'it bears mentioning',
  'in conclusion', 'to sum up', 'the bottom line',
  'navigate challenges', 'navigate obstacles', 'navigate the',
  // Significance inflation / fake legacy
  'stands as a', 'testament to', 'pivotal role', 'pivotal moment', 'crucial role',
  'vital role', 'underscores the importance', 'highlights the importance',
  'setting the stage for', 'key turning point', 'indelible mark',
  'evolving landscape', 'ever-evolving', 'ever-changing',
  // Promotional puffery
  'nestled', 'in the heart of', 'boasts', 'breathtaking', 'must-visit',
  // High-frequency AI vocabulary
  'delve', 'delves', 'delving', 'tapestry', 'interplay',
  // Filler / negative parallelism
  "it's important to note", 'it is important to note',
  'not just about',
  // Chatbot-correspondence artifacts pasted into content
  'i hope this helps', 'let me know if you', 'would you like me to',
  // Knowledge-cutoff leakage
  'knowledge cutoff', 'my training data', 'as of my last',
  // Social-post cadence: the beat that asks the reader to be impressed.
  // Drawn from t0ddharris/slopster (MIT).
  'let that sink in', 'read that again', 'and that changes everything',
  'imagine a world where', 'in the realm of', 'paradigm shift',
  'unleash the power of', 'unleash the potential of',
  // Closing filler, same family as "in conclusion"
  'at the end of the day', 'all things considered', 'in the final analysis',
  // Marketing puffery, same family as "boasts"/"breathtaking"
  'best-in-class', 'world-class', 'next-generation',
  "in today's fast-paced world", "in today's digital age",
]

/**
 * Opt-in vocabulary, deliberately NOT in the defaults. These are ordinary
 * professional English that LLMs happen to overuse: banning `leverage` or
 * `comprehensive` outright would make the linter grade writing QUALITY rather
 * than flag machine authorship, which is the line this tool holds. A site that
 * wants the stricter voice opts in per repo with `"phrasePacks": ["aggressive"]`.
 *
 * Sourced from t0ddharris/slopster's JargonSwaps and WeakWords (MIT). Its
 * bare intensifiers (`very`, `clearly`, `obviously`) and personal-tic entries
 * (`quiet\w*`, `sharp\w*`, `drift`, `lands`) are left out on purpose: a rule
 * that fires on every word starting with "sharp" teaches writers to ignore the
 * linter, which costs more than the tell it catches.
 */
export const AGGRESSIVE_PHRASES = [
  'utilize', 'utilise', 'leverage', 'facilitate', 'comprehensive',
  'innovative', 'groundbreaking', 'holistic', 'transformative',
  'multifaceted', 'nuanced', 'synergy', 'bolster', 'unveil', 'streamline',
  'elucidate', 'ascertain', 'endeavour', 'foster', 'unleash',
  'full potential', 'at its core', 'that being said', 'to put it simply',
  'this begs the question',
]

/** Named phrase packs a config opts into by name. See AGGRESSIVE_PHRASES. */
export const PHRASE_PACKS: Record<string, string[]> = {
  aggressive: AGGRESSIVE_PHRASES,
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------- reveal shape ----------

// The "here is the hidden truth / what you are getting wrong" framing.
// Generalized from t0ddharris/slopster's Openers.yml (MIT), which lists the
// same families as fixed tokens; these four regexes cover its list and the
// rewordings a token match misses.
// Two deliberate narrowings, both of which cost false positives when they were
// absent. The first draft accepted a bare `people`/`they` as the subject and a
// bare `says`/`knows` as the verb, which made "the audit records what people
// say about the outage" and "we logged what they know" into findings. On a
// default-ON rule that is the worst kind of bug.
//
// SUBJECT must be a universal quantifier. The tease works by claiming everyone
// else is in the dark, so "nobody"/"everyone"/"most people" carry the shape and
// a bare "people"/"they" is just ordinary English.
const CROWD = `(?:nobody|no one|noone|everyone|everybody|most people)`
// VERB must be a withholding or an error, and "tell" needs its object. "What
// nobody tells you" is a tease; "what people tell the auditor" is a sentence.
const REVEAL_VERB = `(?:tells?\\s+you|telling\\s+you|talks?\\s+about|warns?\\s+you|gets?\\s+wrong|miss(?:es)?|skips?|overlooks?)`
export const REVEAL_SHAPE: RegExp[] = [
  // "what nobody tells you", "the part everyone skips", "what most people miss"
  new RegExp(`\\b(?:what|the (?:thing|part|bit|secret)|the (?:one )?thing)\\s+(?:that\\s+)?${CROWD}\\s+(?:really\\s+|actually\\s+|ever\\s+)?${REVEAL_VERB}`, 'i'),
  // "nobody tells you", "no one warns you about"
  new RegExp(`\\b(?:nobody|no one|noone)\\s+(?:ever\\s+)?(?:tells|warns|talks to|prepares)\\s+you\\b`, 'i'),
  // "this is the thing everyone gets wrong", "that's the secret most people miss"
  new RegExp(`\\b(?:this|that|it)(?:'s|\\s+is)\\s+the\\s+(?:thing|part|bit|secret)\\s+(?:that\\s+)?${CROWD}\\b`, 'i'),
  // "what they don't tell you", "what they never mention". `they` is idiomatic
  // HERE because the withholding verb carries the shape, so the verb is pinned
  // to tell/mention rather than the loose family above.
  new RegExp(`\\bwhat\\s+(?:they|${CROWD})\\s+(?:don'?t|doesn'?t|won'?t|never)\\s+(?:tell|mention)\\b`, 'i'),
]

// ---------- invisible / nonstandard unicode ----------

const INVISIBLE_RE =
  /[\u00AD\u00A0\u1680\u2000-\u200F\u202A-\u202F\u205F\u2060-\u2064\u2066-\u2069\u3164\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu

interface InvisibleMatch {
  index: number
  length: number
  cp: number
}

function INVISIBLE_RE_MATCHES(line: string): InvisibleMatch[] {
  const out: InvisibleMatch[] = []
  let m: RegExpExecArray | null
  INVISIBLE_RE.lastIndex = 0
  while ((m = INVISIBLE_RE.exec(line))) {
    out.push({ index: m.index, length: m[0].length, cp: m[0].codePointAt(0)! })
  }
  return out
}

/** Full code point immediately before code-unit index i, or -1. */
function cpBefore(line: string, i: number): number {
  if (i <= 0) return -1
  const c = line.codePointAt(i - 1)!
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) return line.codePointAt(i - 2)!
  return c
}

/** Full code point starting at code-unit index i, or -1. */
function cpAfter(line: string, i: number): number {
  if (i >= line.length) return -1
  return line.codePointAt(i)!
}

const EMOJIISH = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D\u20E3#*0-9]/u
function isEmojiish(cp: number): boolean {
  return cp >= 0 && EMOJIISH.test(String.fromCodePoint(cp))
}

// Scripts where ZWJ/ZWNJ are real orthography (Arabic, Persian, Indic).
const JOINER_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF]/u
function isJoinerScript(cp: number): boolean {
  return cp >= 0 && JOINER_SCRIPT.test(String.fromCodePoint(cp))
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)
}

const CHAR_NAMES: Record<number, string> = {
  0x00ad: 'SOFT HYPHEN',
  0x00a0: 'NO-BREAK SPACE',
  0x1680: 'OGHAM SPACE MARK',
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x202f: 'NARROW NO-BREAK SPACE',
  0x205f: 'MEDIUM MATHEMATICAL SPACE',
  0x2060: 'WORD JOINER',
  0x3164: 'HANGUL FILLER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE (BOM)',
}

function charName(cp: number): string {
  if (CHAR_NAMES[cp]) return CHAR_NAMES[cp]
  if (cp >= 0x2000 && cp <= 0x200a) return 'NON-STANDARD SPACE'
  if (cp >= 0x202a && cp <= 0x202e) return 'DIRECTIONAL FORMATTING MARK'
  if (cp >= 0x2061 && cp <= 0x2064) return 'INVISIBLE OPERATOR'
  if (cp >= 0x2066 && cp <= 0x2069) return 'DIRECTIONAL ISOLATE'
  if (isVariationSelector(cp)) return 'VARIATION SELECTOR'
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'TAG CHARACTER (hidden-data / prompt-injection channel)'
  return 'INVISIBLE CHARACTER'
}

/** Char-level mask: true = skip (inside code/quote/comment/link-url). Code,
 *  quotes, and URLs legitimately contain arrows, em-dashes, "robust" API
 *  names, and enumeration ellipses. */
function buildSkipMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false)
  const mark = (start: number, len: number) => {
    for (let i = start; i < start + len && i < mask.length; i++) mask[i] = true
  }
  let m: RegExpExecArray | null

  const codeBlock = /```[\s\S]*?```/g
  while ((m = codeBlock.exec(text))) mark(m.index, m[0].length)
  const inlineCode = /`[^`\n]+`/g
  while ((m = inlineCode.exec(text))) if (!mask[m.index]) mark(m.index, m[0].length)
  const htmlComment = /<!--[\s\S]*?-->/g
  while ((m = htmlComment.exec(text))) mark(m.index, m[0].length)

  let idx = 0
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('>')) mark(idx, line.length)
    idx += line.length + 1
  }
  const link = /\[([^\]]+)\]\(([^)]+)\)/g
  while ((m = link.exec(text))) mark(m.index + 1 + m[1].length + 2, m[2].length)

  return mask
}

export interface LintExtras {
  /** Replaces the built-in opener list (see resolveConfig). */
  openers?: string[]
  /** Site-specific rules, reported as `custom: <id>`. Skip mask honored. */
  customRules?: { id: string; re: RegExp; suggestion?: string }[]
  /** Site arrow conventions beyond the universal core exemptions.
   *  trailingCta: a "→" ending a line or a link text (the external-link CTA
   *  convention some sites use) stops being a finding. */
  arrows?: { trailingCta?: boolean }
  /** Per-rule severity overrides, keyed by rule ID (see severityOf). */
  severities?: Record<string, Severity>
}

// Universal arrow exemptions (breadcrumb/pipeline, leading back-link) plus the
// opt-in trailing-CTA convention. See the rules.arrows block for the rationale.
const CAPISH = /^[`[("']*[A-Z0-9]/
function arrowExempt(line: string, i: number, opts?: { trailingCta?: boolean }): boolean {
  const ch = line[i]
  if (ch === '←' && /^\s*(?:[-*+]\s+)?\[?\s*$/.test(line.slice(0, i))) return true // back-link
  if (ch !== '→') return false
  const before = line.slice(0, i).trimEnd()
  const after = line.slice(i + 1).trimStart()
  // Breadcrumb / pipeline: Capitalized (or digit/code) tokens on BOTH sides.
  const left = before.split(/\s+/).pop() ?? ''
  const right = after.split(/\s+/)[0] ?? ''
  if (left && right && CAPISH.test(left) && CAPISH.test(right)) return true
  // Trailing external-link CTA (per-site convention, config opt-in): the arrow
  // ends the line, or ends the text of a markdown link.
  if (opts?.trailingCta && /^(?:\]\([^)]*\))?\s*$/.test(after)) return true
  return false
}

/** Lint any text (title, description, body) against the mechanical tells. */
export function lint(
  raw: string,
  rules: RuleSet = NEUTRAL,
  banned: string[] = DEFAULT_BANNED_PHRASES,
  extras: LintExtras = {}
): Violation[] {
  if (!raw) return []
  // Straighten the typographic apostrophe before matching. U+2019 is ONE code
  // unit, same as U+0027, so this is index-preserving and every offset, mask
  // position and excerpt below stays valid.
  //
  // This is not cosmetic. Generated prose is smart-quoted far more often than
  // the plaintext corpora are, and every contraction-bearing pattern here was
  // ASCII-only: `isn't a rewrite. It's a rename` was a finding while
  // `isn’t a rewrite. It’s a rename` was clean, and the same held for the
  // reveal-shape and banned-opener families. The rule that most needed to fire
  // on model output was the one blind to how model output is punctuated.
  const text = normalizeEol(stripBom(straighten(raw)))
  banned = banned.map(straighten)
  const openers = (extras.openers ?? BANNED_OPENERS).map(straighten)
  // Longest first so a nested entry cannot claim the span ahead of the phrase
  // that contains it (see the span dedup in the phrase loop).
  const bannedByLength = [...banned].sort((a, b) => b.length - a.length)
  const violations: Violation[] = []
  const mask = buildSkipMask(text)
  const lines = text.split('\n')
  // The excerpt is cut from the text as written, not as straightened, so a
  // host can find it in its own source. Straightening is one code unit for
  // one, so the two line arrays share every offset.
  const source = normalizeEol(stripBom(raw))
  const sourceLines = source.split('\n')
  // Sentence ends per line, found once, on the first finding that needs them.
  const endsCache = new Map<number, number[]>()
  const excerpt = (li: number, col: number, end: number) => {
    let ends = endsCache.get(li)
    if (!ends) endsCache.set(li, (ends = sentenceEnds(sourceLines[li])))
    return excerptAt(sourceLines[li], col, end, ends)
  }

  const lineStarts: number[] = []
  let acc = 0
  for (const line of lines) {
    lineStarts.push(acc)
    acc += line.length + 1
  }

  const sev = (rule: string) => severityOf(rule, extras.severities)
  // `col`..`end` is the matched span. The excerpt quotes the sentence that
  // holds it (see excerptAt), not the start of the line: a "line" is a whole
  // paragraph, and its first 80 characters are often not what was flagged.
  const push = (li: number, col: number, rule: string, suggestion: string, end: number) => {
    if (mask[lineStarts[li] + col]) return
    violations.push({ line: li + 1, rule, excerpt: excerpt(li, col, end), suggestion, severity: sev(rule) })
  }
  // For rules where the skip mask must NOT apply: a hidden character inside a
  // code block or quote is more suspicious, not less.
  const pushAlways = (li: number, col: number, end: number, rule: string, suggestion: string) => {
    violations.push({ line: li + 1, rule, excerpt: excerpt(li, col, end), suggestion, severity: sev(rule) })
  }

  lines.forEach((line, li) => {
    let m: RegExpExecArray | null

    // Artifacts with no legitimate prose use — always on.
    const mathBold = /[\u{1D400}-\u{1D7FF}]/gu
    while ((m = mathBold.exec(line))) push(li, m.index, 'unicode-bold', 'Use markdown **bold**, not unicode math characters.', m.index + m[0].length)

    const bubble = /💬.{0,60}(Question:|\?)/iu
    if ((m = bubble.exec(line))) push(li, m.index, 'engagement-bait', 'Remove the speech-bubble-before-question. Reads as AI bait.', m.index + m[0].length)

    // Invisible / nonstandard Unicode — zero-width characters, soft hyphens,
    // directional marks, nonstandard spaces, variation selectors, and the tag
    // block (U+E0000-E007F, a documented steganography and prompt-injection
    // channel). Always on, and it IGNORES the skip mask. Carve-outs: ZWJ inside
    // emoji sequences, ZWNJ/ZWJ adjacent to scripts where they are real
    // orthography (Arabic, Persian, Indic), a single VS15/16 giving an emoji
    // or keycap its presentation, and a byte-order mark at file position 0.
    // What this canNOT see: statistical (token-sampling) watermarks — there is
    // nothing on the page to match.
    for (const inv of INVISIBLE_RE_MATCHES(line)) {
      const cp = inv.cp
      const abs = lineStarts[li] + inv.index
      // No carve-out for a BOM at position 0: stripBom already removed the one
      // legitimate file marker before matching, so anything still sitting here
      // is a SECOND BOM, which is an artifact (a concatenated export, or a
      // re-encode of a file that already had one) and reports like any other.
      void abs
      const prev = cpBefore(line, inv.index)
      const next = cpAfter(line, inv.index + inv.length)
      if (cp === 0x200d && (isEmojiish(prev) || isEmojiish(next) || isJoinerScript(prev) || isJoinerScript(next))) continue
      if (cp === 0x200c && (isJoinerScript(prev) || isJoinerScript(next))) continue
      if ((cp === 0xfe0e || cp === 0xfe0f) && !isVariationSelector(prev) && !isVariationSelector(next) && isEmojiish(prev)) continue
      const run = isVariationSelector(cp) && (isVariationSelector(prev) || isVariationSelector(next))
      pushAlways(
        li,
        inv.index,
        inv.index + inv.length,
        'invisible-unicode',
        `${charName(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})${run ? ' in a variation-selector RUN — the shape of hidden encoded data' : ''}. Delete it or replace with the plain equivalent; these arrive via copy-paste, generation artifacts, or deliberate fingerprinting.`
      )
    }

    if (rules.emDash) {
      const emDash = /—/g
      while ((m = emDash.exec(line))) push(li, m.index, 'em-dash', 'Use a period, comma, or restructure. Em-dashes are a common AI tell.', m.index + m[0].length)
    }

    if (rules.ellipsis) {
      const ellipsis = /…|\.\.\./g
      while ((m = ellipsis.exec(line))) push(li, m.index, 'ellipsis', 'Finish the thought or start a new sentence; dramatic ellipses read as AI.', m.index + m[0].length)
    }

    // Arrows in narrative prose are a tell, but three uses are universal
    // documentation conventions and exempt in core: breadcrumb/menu paths
    // ("Settings → Connections → Delete"), pipeline notation
    // ("Input → Transform → Output") — both detected as an arrow whose
    // immediate left AND right words are Capitalized/digit/code tokens — and a
    // leading "←" back-link. A trailing "→" external-link CTA is a per-site
    // convention, so that one is opt-in via config (arrowExemptions.trailingCta).
    // The class is `u`-flagged and holds BMP arrows ONLY. A literal astral
    // char here (the pointing hand used to be) decomposes into surrogate code
    // units without `u`, so the class matches EITHER half independently — which
    // silently flagged every emoji sharing the U+D83D high surrogate (🚀 🔗 💀,
    // roughly U+1F400-U+1F6FF) as an arrow, and double-reported the hand itself.
    // The pointing hand is an emoji, so emoji-decoration owns it; arrows do not.
    if (rules.arrows) {
      const arrow = /[→⇒←]/gu
      while ((m = arrow.exec(line))) {
        if (arrowExempt(line, m.index, extras.arrows)) continue
        push(li, m.index, 'arrow-symbol', 'Use "means," "leads to," "so," or restructure.', m.index + m[0].length)
      }
    }

    if (rules.hrDivider && line.trim() === '---') {
      push(li, Math.max(0, line.indexOf('-')), 'horizontal-rule', 'Use a heading or white space, not a --- divider.', line.length)
    }

    if (rules.bannedOpeners) {
      for (const opener of openers) {
        const re = new RegExp(`(^\\s*|\\.\\s+)(${escapeRegex(opener)})\\b`, 'i')
        if ((m = re.exec(line))) push(li, m.index + m[1].length, `banned opener: "${opener}"`, 'Overused AI opener. State the thing directly.', m.index + m[0].length)
      }
    }

    // Four shapes of the forward contrast flourish. The patterns overlap (the
    // contraction form can also match "not just X, but Y"), so hits are
    // deduped by span — one report per stretch of text.
    if (rules.contrastSlop) {
      // Both sides are bounded by what the corpus harness measured, not by
      // what looked reasonable. See corpus/REPORT.md.
      //
      // NEGATION: copulas plus can't/won't/cannot. Widening this to the
      // lexical auxiliaries (`do not need`, `doesn't contribute`) TRIPLED the
      // rate on human technical prose, because "you do not need to set this
      // field. It is automatically populated" negates an ACTION and then
      // starts a new statement. Only an identity or possibility claim gets
      // reasserted, so only those belong on the left.
      //
      // BOUNDARY: sentence-final punctuation only. The old `[.;:!?]` treated
      // a semicolon as a sentence end, so the discourse marker `; that is,`
      // read as a reassertion.
      //
      // REASSERTION: a copula or auxiliary follow-up. Widening to any lexical
      // verb ("It leaks.", "They amplify the outage.") is what a token list
      // does, and it swallows plain two-sentence prose.
      //
      // PROGRESSIVE: one action negated and another reported, by a plural
      // or personal subject ("the inspector is not glancing for missing
      // shingles. They are checking the drains.") is a description of what
      // someone does, the same as `do not need` above, and is left out. All
      // three conditions hold, or it reports:
      //  - on the left, an -ing word, optionally after one -ly adverb,
      //    followed by a verb's complement (VERB_COMPLEMENT). "These aren't
      //    marketing tactics." has a noun after it and reports. "The problem is not pricing. It is positioning." ends the
      //    clause on it and reads as a noun; `something` and the other -ing
      //    nouns in NOT_PROGRESSIVE are nouns wherever they sit.
      //  - a reassertion that is itself a progressive verb ("They are
      //    checking"). "Flash and HTML5 are not directly competing
      //    technologies. They are simply two different ways..." has an -ing
      //    adjective on the left and an identity on the right, and reports.
      //  - a reassertion by they/these/those. With it/this/that the -ing
      //    phrase is an identity claim, which is the flourish itself:
      //    "Success isn't getting more traffic. It's getting the right
      //    traffic." Known cost: an action-to-action flourish with a
      //    determiner, such as "Buyers aren't buying a tool. They're buying
      //    an outcome.", is left out with the rest.
      const reassert = CONTRAST_REASSERT
      reassert.lastIndex = 0
      const consequence = /\b(?:is|are)\s+not\s+[^,.;]{1,30},\s+(?:and\s+)?(?:until|unless)\b/i
      // The comma forms, mirrored from a production linter tuned on real copy: the
      // 60-char cap and the no-sentence-punctuation middle keep a match inside
      // one clause pair instead of running across the paragraph.
      const commaForm = /\b(?:it'?s|its|this is|that'?s|we'?re|you'?re)\s+not\s+[^,;:.!?]{2,60},\s*(?:it'?s|its|this is|that'?s|we'?re|you'?re|but)\b/gi
      const notJustBut = /\bnot\s+just\s+[^,;:.!?]{2,60},\s*but\b/gi

      const spans: [number, number][] = []
      const hit = (start: number, end: number) => {
        if (spans.some(([s, e]) => start < e && end > s)) return
        spans.push([start, end])
        push(li, start, 'contrast-slop', '"Not X, it\'s Y" flourish. State what it IS directly; one deliberate, concrete reclassification per piece at most.', end)
      }
      while ((m = reassert.exec(line))) {
        const actionToAction =
          CONTRAST_PROGRESSIVE.test(line.slice(m.index + m[1].length)) &&
          /^(?:they|these|those)\b/i.test(m[2]) &&
          CONTRAST_PROGRESSIVE_REPLY.test(line.slice(m.index + m[0].length))
        if (!actionToAction) {
          hit(m.index, m.index + m[0].length)
          break
        }
        reassert.lastIndex = m.index + 1
      }
      if ((m = consequence.exec(line))) hit(m.index, m.index + m[0].length)
      while ((m = commaForm.exec(line))) hit(m.index, m.index + m[0].length)
      while ((m = notJustBut.exec(line))) hit(m.index, m.index + m[0].length)
    }

    if (rules.reversedAntithesis) {
      const reversed = /,\s+(?:not|never)\s+(?:just\s+)?[^,;:.!?]{2,70}(?=[,.!?;:]|$)/gi
      while ((m = reversed.exec(line))) {
        push(li, m.index, 'reversed-antithesis', 'Trailing "X, not Y" contrast. Delete the contrast: if no information is lost it was a flourish — cut it. Keep it only when the contrast IS the point.', m.index + m[0].length)
      }
    }

    // The reveal shape: the sentence withholds its point and sells the
    // withholding ("what nobody tells you", "the part everyone skips"). It
    // survives rewording, which is why a phrase list does not catch it, and it
    // casts the reader as the one getting it wrong. Patterns are tried in
    // order and only the first hit on a line reports, since the families
    // overlap ("the thing everyone gets wrong" matches two of them).
    if (rules.revealShape) {
      for (const re of REVEAL_SHAPE) {
        if ((m = re.exec(line))) {
          push(li, m.index, 'reveal-shape', 'Teases the point instead of stating it, and casts the reader as the one getting it wrong. Say the thing directly.', m.index + m[0].length)
          break
        }
      }
    }

    if (rules.inlineHeaderBullets) {
      const ihb = /^(\s*[-*+]\s+)\*\*[^*\n]+?(?::\*\*|\*\*:)/
      if ((m = ihb.exec(line))) push(li, m[1].length, 'inline-header-bullet', 'Rewrite "**Term:** sentence" bullets as prose or plain list items.', m[0].length)
    }

    if (rules.emojiDecor) {
      const emoji = /(?![©®™])\p{Extended_Pictographic}/gu
      while ((m = emoji.exec(line))) push(li, m.index, 'emoji-decoration', 'Drop the emoji; decorated headings/bullets read as AI.', m.index + m[0].length)
    }

    if (rules.boldOveruse && !line.trimStart().startsWith('|')) {
      const bold = /\*\*[^*\n]+\*\*/g
      let boldCount = 0
      while ((m = bold.exec(line))) {
        if (mask[lineStarts[li] + m.index]) continue
        if (++boldCount === 3) {
          push(li, m.index, 'bold-overuse', '3+ bold spans in one paragraph. Bold at most the one phrase that matters, or none.', m.index + m[0].length)
          break
        }
      }
    }

    // Longest phrase first, then report once per span. Entries legitimately
    // nest — the `aggressive` pack bans bare `unleash` while the defaults ban
    // `unleash the power of` — and without this, one span produced one finding
    // per matching entry, which reads as two problems in the same six words.
    const phraseSpans: [number, number][] = []
    for (const phrase of bannedByLength) {
      const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i')
      if (!(m = re.exec(line))) continue
      const [start, end] = [m.index, m.index + m[0].length]
      if (phraseSpans.some(([s, e]) => start < e && end > s)) continue
      phraseSpans.push([start, end])
      push(li, start, `banned phrase: "${phrase}"`, 'AI filler. Rephrase or cut.', end)
    }

    for (const cr of extras.customRules ?? []) {
      if ((m = cr.re.exec(line))) push(li, m.index, `custom: ${cr.id}`, cr.suggestion ?? 'Site rule.', m.index + m[0].length)
    }
  })

  // Structural rules (markdown-aware, multi-line).
  if (rules.headingDependentOpener) {
    for (const v of headingDependentOpeners(source)) violations.push({ ...v, severity: sev(v.rule) })
  }
  if (rules.demonstrativeHeading) {
    for (const v of demonstrativeHeadings(source)) violations.push({ ...v, severity: sev(v.rule) })
  }

  return violations.sort((a, b) => a.line - b.line)
}

// -ing words that are nouns, never a progressive verb (see contrastSlop). An
// explicit list: a `[a-z]*thing` family would also swallow breathing, bathing
// and soothing, which are verbs.
const NOT_PROGRESSIVE = `(?:thing|nothing|something|anything|everything|clothing|plaything|during|morning|evening|ceiling|string|spring|king|ring|wing)`
// contrastSlop's patterns. Built once: the reassertion regex is global and
// stateful, so each line resets its lastIndex.
const CONTRAST_NEG = `(?:\\b(?:is|are|was|were)\\s+not\\b|\\b(?:is|are|was|were|ca|wo)n'?t\\b|\\bcannot\\b|(?:'s|'re)\\s+not\\b)`
const CONTRAST_REASSERT_TAIL = `(?:it|that|this|they|these|those)(?:\\s+(?:is|are|was|were|does|do|did|will|can)|'s|'re)\\b`
const CONTRAST_REASSERT = new RegExp(`(${CONTRAST_NEG})[^.!?]{0,60}[.!?]\\s+(${CONTRAST_REASSERT_TAIL})`, 'gi')
// An -ing verb, optionally after one -ly adverb. Shared by both sides.
const ING_VERB = `^\\s+(?:[a-z]+ly\\s+)?(?!${NOT_PROGRESSIVE}\\b)[a-z]+ing`
// What follows a verb and not a noun modifier: a determiner, a preposition,
// a pronoun or an -ly adverb. "glancing for", "checking the logs" and
// "breathing heavily" are actions; "marketing tactics" and "boring meetings"
// are nouns, and their sentence is an identity claim.
const VERB_COMPLEMENT = `(?:a|an|the|this|that|these|those|my|your|his|her|its|our|their|some|any|every|each|no|more|all|it|them|him|me|us|you|for|at|to|in|on|with|from|into|through|about|over|under|around|up|down|out|off|by|of|[a-z]+ly)\\b`
const CONTRAST_PROGRESSIVE = new RegExp(`${ING_VERB}\\s+${VERB_COMPLEMENT}`, 'i')
const CONTRAST_PROGRESSIVE_REPLY = new RegExp(`${ING_VERB}\\b`, 'i')

/** Longest excerpt a finding quotes. */
const EXCERPT_MAX = 200
// A period after one of these is not a sentence end ("Dr. Smith"). Single
// initials are not on it: "plan B." and "Vitamin C." end sentences far more
// often in prose than "J. Smith" sits mid-sentence.
const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'jr', 'sr', 'vs', 'cf', 'fig', 'inc', 'ltd', 'approx', 'no'])
// A run of . ! ? and any closing quotes or brackets, then spaces or tabs and
// something that is not a lowercase letter, or the end of the line. Only
// ASCII space and tab count as the gap: a no-break or zero-width space is
// itself a finding (invisible-unicode), and must stay inside the excerpt that
// reports it. Requiring a non-lowercase start is what keeps "e.g. the roof"
// and "we waited... and waited" one sentence.
const SENTENCE_END = /[.!?]+["'\u2019\u201d)\]*_]*(?=[ \t]+(?![ \ta-z])|[ \t]*$)/g

/** Where each sentence of `line` ends (exclusive offsets). */
function sentenceEnds(line: string): number[] {
  const ends: number[] = []
  SENTENCE_END.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SENTENCE_END.exec(line))) {
    // The word before the period, without the quotes, brackets and emphasis
    // marks that wrap it ("**Dr. Smith**", "\u2018Dr. Smith\u2019"). Read from
    // a short window so a long line is not re-sliced from its start each time.
    const before = line.slice(Math.max(0, m.index - 12), m.index)
    const word = (/([^\s]+)$/.exec(before)?.[1] ?? '').replace(/^[(["'*_\u2018\u201c]+/, '').toLowerCase()
    // Also a dotted abbreviation ("e.g", "U.S") and a list number at the
    // start of a line ("1. First").
    const abbreviation =
      m[0][0] === '.' &&
      m[0].length === 1 &&
      (ABBREVIATIONS.has(word) || /^[a-z](?:\.[a-z])+$/.test(word) || (/^\d+$/.test(word) && !line.slice(0, m.index - word.length).trim()))
    if (!abbreviation) ends.push(m.index + m[0].length)
  }
  return ends
}

const isGap = (c: string | undefined) => c === ' ' || c === '\t'
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/**
 * The text a finding quotes: from the start of the sentence that holds the
 * match through the end of the sentence the match ends in, so a reviewer (or
 * a fix that edits only the quoted text) sees the flagged words in context.
 *
 * Always a verbatim substring of `line`. Capped at EXCERPT_MAX: when the
 * sentence is longer, the excerpt is the match with as much of the sentence
 * on each side as the cap allows, cut on word boundaries. The match itself is
 * kept whole unless it is longer than the cap, in which case its first
 * EXCERPT_MAX characters are the excerpt.
 */
function excerptAt(line: string, start: number, end: number, ends: number[] = sentenceEnds(line)): string {
  start = Math.max(0, Math.min(start, line.length))
  end = Math.max(start, Math.min(end, line.length))
  let from = 0
  for (const e of ends) if (e <= start) from = e
  let to = line.length
  for (const e of ends) {
    if (e >= end) {
      to = e
      break
    }
  }
  while (from < start && isGap(line[from])) from++
  while (to > end && isGap(line[to - 1])) to--
  if (to - from <= EXCERPT_MAX) return line.slice(from, to)
  if (end - start > EXCERPT_MAX) {
    // Never end on half of a surrogate pair.
    const cut = isHighSurrogate(line.charCodeAt(start + EXCERPT_MAX - 1)) ? EXCERPT_MAX - 1 : EXCERPT_MAX
    return line.slice(start, start + cut)
  }

  // The budget left after the match is shared between the text before it
  // and the text after it: each side gets what it needs when the other needs
  // less than half, and half otherwise.
  const spare = EXCERPT_MAX - (end - start)
  const leadWant = start - from
  const tailWant = to - end
  const lead = Math.min(leadWant, Math.max(spare - tailWant, Math.floor(spare / 2)))
  const tail = Math.min(tailWant, spare - lead)
  let ws = start - lead
  let we = end + tail
  // Start and stop on whole words, never inside the match.
  if (ws > from && !isGap(line[ws - 1])) {
    let gap = ws
    while (gap < start && !isGap(line[gap])) gap++
    ws = gap < start ? gap + 1 : start
  }
  if (we < to && !isGap(line[we])) {
    let gap = we
    while (gap > end && !isGap(line[gap])) gap--
    we = gap
  }
  while (we > end && isGap(line[we - 1])) we--
  return line.slice(ws, we)
}

// A heading is a SUMMARY of its section: the prose never builds off it. Delete
// every heading and the body must still read as complete prose. This catches
// the mechanically detectable failures, in the section's FIRST sentence only:
//
// 1. The sentence opens on a bare referring word ("This is where it learns.").
// 2. Anywhere in it, a demonstrative points back at something no prose has
//    named: "this part", "that step", or a bare "these" as an object ("set
//    these up"). With the headings deleted, nothing is left for it to mean.
//
// Precision beats recall. Left alone: a referring word that re-names its
// subject in the same breath ("Both methods produce..."); a demonstrative on
// a noun the prose already used, in this sentence or anywhere above the
// heading; "these" or "those" on a noun, and "all of that", which sum up the
// sections above ("these commands" after a section of commands); one past the
// first clause, where the sentence has named things of its own; one that
// points at time ("this year") or at the document ("this guide", "reading
// this"); and one that points forward, to a colon or to the list or code
// block the sentence introduces ("try these prompts" over a list of prompts).
const REFERRING = `it|it's|this|these|those|that|they|both|neither|such`
const BARE_VERB = `is|isn't|are|aren't|was|were|will|would|can|can't|could|should|shall|do|does|did|has|have|had|may|might|must|'s|'re`
const REFERRING_OPENER = new RegExp(`^(${REFERRING})(\\s+(${BARE_VERB})\\b|\\s*[.,;:!?])`, 'i')

const words = (s: string) => s.split(/\s+/).filter(Boolean)

// Words that cannot be the noun of "this X": after one of these the
// demonstrative is a pronoun, a conjunction or a relative ("that you", "that
// is"), never a determiner.
const NOT_A_NOUN = new Set(
  words(`
    a an the this that these those it its it's they them their theirs he him his she her hers we us our ours you your yours i me my mine
    who whom whose which what when where why how there here
    is isn't are aren't was wasn't were weren't be been being am do does did doesn't don't didn't has have had hasn't haven't
    will won't would wouldn't can can't cannot could couldn't should shouldn't shall may might must
    not no nor never also only just even still really very too so then than now already always often enough
    and or but if because unless while although though since until as
    of to in on at by for with from into onto about over under up down out off away back through after before between against without within
    all any each every some many much more most few less least other another such both either neither said
    everyone everybody everything someone somebody something anyone anybody anything nobody nothing people children men women folks
  `)
)

const KIND_WORDS = new Set(words('kind kinds sort sorts type types'))

// After "that" + word, an object or a particle means "that" opened a relative
// clause on a verb ("minutes that cover most pipelines", "files that show up").
const OPENS_OBJECT = new Set(
  words('a an the its their your our his her my this these those most many some all every each any no one them you us it me him up out down off')
)

// A bare demonstrative as an object ("set these up", "if you've tried this,")
// closes on one of these words or on punctuation. Only `this` and `these`:
// bare `that` is a relative or a conjunction as often as a pronoun, and bare
// `those` is almost always generic ("those who", "those of you").
const BARE_OBJECT_FOLLOW = new Set(
  words('up down out off away back over in on at by for to with into about from and or but so because if when unless before after')
)

// "this year", "these days": a demonstrative that points at time, not at an
// earlier noun. "this guide", "this post": one that points at the document.
const DEICTIC_NOUNS = new Set(
  words(`
    year years month months week weeks day days morning afternoon evening night tonight weekend weekends quarter season
    spring summer fall autumn winter time times moment decade century point space
    post posts article articles guide guides page pages piece tutorial chapter section book essay video episode series site website newsletter
  `)
)

// "that" in front of a clause, not a noun: "shows that", "so that".
const COMPLEMENTIZER_BEFORE = new Set(
  words(`
    so now given such except provided in
    say says said show shows showed shown mean means meant think thinks thought know knows knew find finds found
    suggest suggests suggested note notes noted ensure ensures ensured believe believes assume assumes argue argues claim claims
    report reports reported prove proves proved realize realizes realized sure clear true likely possible
    check verify confirm remember notice see expect hope understand learn tell make doubt guarantee hear read
    fact idea chance sign news evidence proof belief hope risk odds
  `)
)

// After a singular noun, "that" followed by one of these opens a relative
// clause: "the version that won", "the plan that best fits".
const CLAUSE_AFTER_THAT = new Set(
  words(`
    won lost broke went ran took grew came became made got gave kept left met paid put sold sent set spent stood told thought wrote
    began brought built bought caught chose drove fell felt fought found held hit hurt knew led meant read rose saw shut sat slept
    spoke stuck struck swore taught threw understood woke wore cost come best better worst first last usually
  `)
)

const WORD = /[A-Za-z][A-Za-z0-9'-]*/g

/** A word reduced far enough that "command" and "commands" compare equal. */
/** The forms a word may have in the singular, so "policies" meets "policy",
 * "shelves" meets "shelf" and "processes" meets "process". Matching too
 * many forms only ever leaves a finding out. */
function forms(w: string): string[] {
  const b = bareWord(w)
  const out = [b]
  if (b.endsWith('s')) out.push(b.slice(0, -1))
  if (b.endsWith('es')) out.push(b.slice(0, -2))
  if (b.endsWith('ies')) out.push(b.slice(0, -3) + 'y')
  if (b.endsWith('ves')) out.push(b.slice(0, -3) + 'f', b.slice(0, -3) + 'fe')
  return out
}

/** Lowercase, without a trailing possessive or hyphen: "File's" is "file". */
function bareWord(w: string): string {
  return w.toLowerCase().replace(/'s$/, '').replace(/[-']+$/, '')
}

/** Prose with code spans and link targets blanked so their words are not read
 * as prose. Same length as the original, so indexes map straight back. */
function maskProse(line: string): string {
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)).replace(/\]\([^)]*\)/g, (m) => ']' + ' '.repeat(m.length - 1))
}

interface Word {
  text: string
  lower: string
  start: number
  end: number
}

/** The span of the first demonstrative in `sentence` that points at nothing
 * the prose has named, or null. `named` holds the forms of every prose word
 * above the section's heading. */
function danglingDemonstrative(sentence: string, named: Set<string>): [number, number] | null {
  const ws: Word[] = [...sentence.matchAll(WORD)].map((m) => ({
    text: m[0],
    lower: bareWord(m[0]),
    start: m.index!,
    end: m.index! + m[0].length,
  }))
  const tight = (a: Word, b: Word | undefined) => !!b && /^\s+$/.test(sentence.slice(a.end, b.start))
  // Only the first clause: past a comma, a bracket or a dash, the sentence has named things of its own for the demonstrative to point
  // at ("records metrics, and provides a UI for browsing that data"). A comma
  // inside a number ("1,000") is not a boundary.
  const boundary = /(?<!\d),|,(?!\d)|[;(\u2013\u2014]/.exec(sentence)?.index ?? sentence.length
  // Something the sentence goes on to spell out: "do this: open the file".
  // Only a colon before a space or the end, so a URL or a time is not one.
  const colon = /:(?=\s|$)/.exec(sentence)?.index ?? -1
  // Forms of the words this sentence has used before the current one.
  const seen = new Set<string>()
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k]
    if (w.start > boundary) break
    if (k > 0) for (const f of forms(ws[k - 1].text)) seen.add(f)
    if (!['this', 'that', 'these', 'those'].includes(w.lower)) continue
    // "that's missing" is "that is", not a determiner.
    if (/'s$/i.test(w.text)) continue
    if (colon > w.end) continue
    const prev = k > 0 ? ws[k - 1].lower : ''
    if (w.lower === 'that' && COMPLEMENTIZER_BEFORE.has(prev)) continue
    // "all of that", "all those": a summary of what the sections above said.
    if (prev === 'all' || (prev === 'of' && ws[k - 2]?.lower === 'all')) continue
    const next = ws[k + 1]

    // "this part", "that step": a determiner on a noun the prose never named.
    if (tight(w, next) && !NOT_A_NOUN.has(next.lower)) {
      // "these commands", "those five examples", "this kind of setup": a
      // summary of the sections above, which shows them in code and lists
      // more often than it names them in a sentence.
      if (w.lower === 'these' || w.lower === 'those' || KIND_WORDS.has(next.lower)) continue
      const noun = next
      if (DEICTIC_NOUNS.has(noun.lower)) continue
      // Past the first word, a word that reads as a verb ("and this makes",
      // "that matters", "that changed") or an adverb ("that really") makes
      // the demonstrative a pronoun or a relative, not a determiner.
      if (k > 0 && (/(?:[^s]s|ed|ly)$/.test(next.lower) || CLAUSE_AFTER_THAT.has(next.lower))) continue
      if (w.lower === 'that') {
        // After a plural noun or a verb, "that" opens a clause ("functions
        // that verify", "indicates that", "mentioned that"). After "that", a
        // capitalized word or a number starts a clause, and so does a verb
        // with its object after it ("files that cover most cases").
        if (/(?:[^s]s|ed)$/.test(prev)) continue
        if (/^[A-Z0-9]/.test(next.text)) continue
        if (tight(next, ws[k + 2]) && OPENS_OBJECT.has(ws[k + 2].lower)) continue
      }
      if (forms(noun.text).some((f) => named.has(f) || seen.has(f))) continue
      return [w.start, noun.end]
    }
    // "set these up", "if you've tried this,": a bare demonstrative as an object.
    if (k === 0 || !(w.lower === 'this' || w.lower === 'these')) continue
    if (prev === 'reading') continue
    const closes = !next || /[.,;!?]/.test(sentence.slice(w.end, next.start)) || (tight(w, next) && BARE_OBJECT_FOLLOW.has(next.lower))
    if (closes) return [w.start, w.end]
  }
  return null
}

const BLOCK_START = /^(\||-|\*|\+|\d+\.|>|```|~~~)/
// What a one-sentence paragraph can introduce: a list, a table, code, or a
// line that is all bold, a label over a run of examples ("**Resize:**").
const INTRODUCED_BLOCK = /^([-*+]\s|\d+\.\s|\||```|~~~|\*\*[^*]+\*\*$)/

export function headingDependentOpeners(md: string): Violation[] {
  const out: Violation[] = []
  // Straighten here too, not only in lint(). These are public exports and
  // their patterns are contraction-bearing and ASCII-only, so a direct caller
  // passing smart-quoted prose would silently get nothing. Straightening is
  // index-preserving, so the line numbers below stay correct.
  const lines = normalizeEol(stripBom(straighten(md))).split('\n')
  const source = normalizeEol(stripBom(md)).split('\n')
  // Stems of the prose words read so far, headings and code left out: what a
  // reader has been told once the headings are deleted.
  const named = new Set<string>()
  // A leading front-matter block is metadata (a title is a heading too).
  let start = 0
  if (lines[0]?.trim() === '---' && /^[A-Za-z_][\w-]*\s*:/.test(lines[1] ?? '')) {
    const close = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l))
    if (close > 0) start = close + 1
  }
  // The open fence ("```" or "~~~", and its length), or null outside one.
  let fence: string | null = null
  for (let i = start; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i])
    // A backtick line with another backtick after the opener is inline code.
    const inline = f && f[1][0] === '`' && lines[i].trim().slice(f[1].length).includes('`')
    if (f && !(fence === null && inline) && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length && !lines[i].trim().slice(f[1].length).trim()))) {
      fence = fence === null ? f[1] : null
      continue
    }
    if (fence !== null) continue
    const h = lines[i].match(/^#{2,6}\s+(.+)/)
    if (!h) {
      if (!/^#\s/.test(lines[i])) for (const m of maskProse(lines[i]).matchAll(WORD)) for (const f of forms(m[0])) named.add(f)
      continue
    }
    const heading = h[1].trim()
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (!t) continue
      if (/^#{1,6}\s/.test(t) || BLOCK_START.test(t)) break
      const at = lines[j].length - lines[j].trimStart().length
      const opener = REFERRING_OPENER.exec(t)
      if (opener) {
        out.push({
          line: j + 1,
          rule: 'heading-dependent-opener',
          excerpt: excerptAt(source[j], at, at + opener[0].length),
          suggestion: `Opens on a referring word whose antecedent is the heading ("${heading}"). Re-name the subject.`,
        })
        break
      }
      if (/^(!\[|<)/.test(t)) break
      // The paragraph, its wrapped lines joined with one space so a sentence
      // that wraps is read whole. `starts` maps an index back to its line.
      const starts: number[] = []
      let para = ''
      for (let m = j; m < lines.length; m++) {
        const u = lines[m].trim()
        if (!u || /^#{1,6}\s/.test(u) || (m > j && BLOCK_START.test(u))) break
        starts.push(para.length + (para ? 1 : 0))
        para += (para ? ' ' : '') + lines[m]
      }
      const prose = maskProse(para)
      const ends = sentenceEnds(prose)
      const sentence = prose.slice(0, ends[0] ?? prose.length)
      // A one-sentence paragraph over a list, table or code block introduces
      // it: "try these prompts" points at the prompts below.
      let after = j + starts.length
      while (after < lines.length && !lines[after].trim()) after++
      if (ends.length <= 1 && INTRODUCED_BLOCK.test(lines[after]?.trim() ?? '')) break
      const span = danglingDemonstrative(sentence, named)
      if (span) {
        let r = 0
        while (r + 1 < starts.length && starts[r + 1] <= span[0]) r++
        const from = span[0] - starts[r]
        const to = Math.min(span[1] - starts[r], lines[j + r].length)
        out.push({
          line: j + r + 1,
          rule: 'heading-dependent-opener',
          excerpt: excerptAt(source[j + r], from, to),
          suggestion: `"${para.slice(span[0], span[1])}" points back at the heading ("${heading}"); no sentence above names it. Name the thing.`,
        })
      }
      break
    }
  }
  return out
}

// Non-question H2/H3 headings ending on a bare singular it/this/that: the
// heading's object lives outside the heading. Question headings are exempt
// (natural FAQ phrasing carries its antecedent in-heading: "Can I use the
// tool without installing it?"), as are plural pronouns (compound-heading
// antecedents: "Common Frame Rates and When to Use Them").
const DEMONSTRATIVE_FINALS = new Set(['it', 'this', 'that'])

export function demonstrativeHeadings(md: string): Violation[] {
  const out: Violation[] = []
  // Straighten here too, not only in lint(). These are public exports and
  // their patterns are contraction-bearing and ASCII-only, so a direct caller
  // passing smart-quoted prose would silently get nothing. Straightening is
  // index-preserving, so the line numbers below stay correct.
  const lines = normalizeEol(stripBom(straighten(md))).split('\n')
  const source = normalizeEol(stripBom(md)).split('\n')
  let inFence = false
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return
    const h = line.match(/^(#{2,3})\s+(.+)/)
    if (!h) return
    const text = h[2].trim()
    if (text.endsWith('?')) return
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length < 2) return
    const last = words[words.length - 1].toLowerCase().replace(/[?!.:]+$/, '')
    if (DEMONSTRATIVE_FINALS.has(last)) {
      out.push({
        line: i + 1,
        rule: 'demonstrative-heading',
        excerpt: excerptAt(source[i], line.indexOf('#'), line.trimEnd().length),
        suggestion: `Heading ends on a bare "${last}" — name the thing.`,
      })
    }
  })
  return out
}

export * from './config.js'
export { VERSION } from './version.js'

export function format(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `- line ${v.line}: [${v.severity ?? 'error'}] ${v.rule} ("${v.excerpt}")${v.suggestion ? ` — ${v.suggestion}` : ''}`
    )
    .join('\n')
}
