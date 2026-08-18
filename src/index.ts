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

export interface Violation {
  line: number
  rule: string
  excerpt: string
  suggestion?: string
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

export const DEFAULT_BANNED_PHRASES = [
  'the reality is', 'the truth is',
  "i'll be honest", 'frankly', 'frankly speaking',
  'game-changer', 'game changer', 'cutting-edge', 'seamless', 'seamlessly', 'robust',
  'in today’s landscape', "in today's landscape", "in today's world", "in today's environment",
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
  "it's important to note", 'it’s important to note', 'it is important to note',
  'not just about',
  // Chatbot-correspondence artifacts pasted into content
  'i hope this helps', 'let me know if you', 'would you like me to',
  // Knowledge-cutoff leakage
  'knowledge cutoff', 'my training data', 'as of my last',
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  text: string,
  rules: RuleSet = NEUTRAL,
  banned: string[] = DEFAULT_BANNED_PHRASES,
  extras: LintExtras = {}
): Violation[] {
  if (!text) return []
  const violations: Violation[] = []
  const mask = buildSkipMask(text)
  const lines = text.split('\n')

  const lineStarts: number[] = []
  let acc = 0
  for (const line of lines) {
    lineStarts.push(acc)
    acc += line.length + 1
  }

  const push = (li: number, col: number, rule: string, suggestion: string) => {
    if (mask[lineStarts[li] + col]) return
    violations.push({ line: li + 1, rule, excerpt: lines[li].trim().slice(0, 80), suggestion })
  }
  // For rules where the skip mask must NOT apply: a hidden character inside a
  // code block or quote is more suspicious, not less.
  const pushAlways = (li: number, rule: string, suggestion: string) => {
    violations.push({ line: li + 1, rule, excerpt: lines[li].trim().slice(0, 80), suggestion })
  }

  lines.forEach((line, li) => {
    let m: RegExpExecArray | null

    // Artifacts with no legitimate prose use — always on.
    const mathBold = /[\u{1D400}-\u{1D7FF}]/gu
    while ((m = mathBold.exec(line))) push(li, m.index, 'unicode-bold', 'Use markdown **bold**, not unicode math characters.')

    const bubble = /💬.{0,60}(Question:|\?)/iu
    if ((m = bubble.exec(line))) push(li, m.index, 'engagement-bait', 'Remove the speech-bubble-before-question. Reads as AI bait.')

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
      if (cp === 0xfeff && abs === 0) continue // legitimate file BOM
      const prev = cpBefore(line, inv.index)
      const next = cpAfter(line, inv.index + inv.length)
      if (cp === 0x200d && (isEmojiish(prev) || isEmojiish(next) || isJoinerScript(prev) || isJoinerScript(next))) continue
      if (cp === 0x200c && (isJoinerScript(prev) || isJoinerScript(next))) continue
      if ((cp === 0xfe0e || cp === 0xfe0f) && !isVariationSelector(prev) && !isVariationSelector(next) && isEmojiish(prev)) continue
      const run = isVariationSelector(cp) && (isVariationSelector(prev) || isVariationSelector(next))
      pushAlways(
        li,
        'invisible-unicode',
        `${charName(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})${run ? ' in a variation-selector RUN — the shape of hidden encoded data' : ''}. Delete it or replace with the plain equivalent; these arrive via copy-paste, generation artifacts, or deliberate fingerprinting.`
      )
    }

    if (rules.emDash) {
      const emDash = /—/g
      while ((m = emDash.exec(line))) push(li, m.index, 'em-dash', 'Use a period, comma, or restructure. Em-dashes are a common AI tell.')
    }

    if (rules.ellipsis) {
      const ellipsis = /…|\.\.\./g
      while ((m = ellipsis.exec(line))) push(li, m.index, 'ellipsis', 'Finish the thought or start a new sentence; dramatic ellipses read as AI.')
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
        push(li, m.index, 'arrow-symbol', 'Use "means," "leads to," "so," or restructure.')
      }
    }

    if (rules.hrDivider && line.trim() === '---') {
      push(li, Math.max(0, line.indexOf('-')), 'horizontal-rule', 'Use a heading or white space, not a --- divider.')
    }

    if (rules.bannedOpeners) {
      for (const opener of extras.openers ?? BANNED_OPENERS) {
        const re = new RegExp(`(^\\s*|\\.\\s+)(${escapeRegex(opener)})\\b`, 'i')
        if ((m = re.exec(line))) push(li, m.index + m[1].length, `banned opener: "${opener}"`, 'Overused AI opener. State the thing directly.')
      }
    }

    // Four shapes of the forward contrast flourish. The patterns overlap (the
    // contraction form can also match "not just X, but Y"), so hits are
    // deduped by span — one report per stretch of text.
    if (rules.contrastSlop) {
      const reassert = /(?:\b(?:is|are|was|were)\s+not\b|\b(?:is|are|was|were)n'?t\b|(?:'s|'re)\s+not\b)[^.;:!?]{0,60}[.;:!?]\s+(?:it|that|this|they)(?:\s+(?:is|are)|'s|'re)\b/i
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
        push(li, start, 'contrast-slop', '"Not X, it\'s Y" flourish. State what it IS directly; one deliberate, concrete reclassification per piece at most.')
      }
      if ((m = reassert.exec(line))) hit(m.index, m.index + m[0].length)
      if ((m = consequence.exec(line))) hit(m.index, m.index + m[0].length)
      while ((m = commaForm.exec(line))) hit(m.index, m.index + m[0].length)
      while ((m = notJustBut.exec(line))) hit(m.index, m.index + m[0].length)
    }

    if (rules.reversedAntithesis) {
      const reversed = /,\s+(?:not|never)\s+(?:just\s+)?[^,;:.!?]{2,70}(?=[,.!?;:]|$)/gi
      while ((m = reversed.exec(line))) {
        push(li, m.index, 'reversed-antithesis', 'Trailing "X, not Y" contrast. Delete the contrast: if no information is lost it was a flourish — cut it. Keep it only when the contrast IS the point.')
      }
    }

    if (rules.inlineHeaderBullets) {
      const ihb = /^(\s*[-*+]\s+)\*\*[^*\n]+?(?::\*\*|\*\*:)/
      if ((m = ihb.exec(line))) push(li, m[1].length, 'inline-header-bullet', 'Rewrite "**Term:** sentence" bullets as prose or plain list items.')
    }

    if (rules.emojiDecor) {
      const emoji = /(?![©®™])\p{Extended_Pictographic}/gu
      while ((m = emoji.exec(line))) push(li, m.index, 'emoji-decoration', 'Drop the emoji; decorated headings/bullets read as AI.')
    }

    if (rules.boldOveruse && !line.trimStart().startsWith('|')) {
      const bold = /\*\*[^*\n]+\*\*/g
      let boldCount = 0
      while ((m = bold.exec(line))) {
        if (mask[lineStarts[li] + m.index]) continue
        if (++boldCount === 3) {
          push(li, m.index, 'bold-overuse', '3+ bold spans in one paragraph. Bold at most the one phrase that matters, or none.')
          break
        }
      }
    }

    for (const phrase of banned) {
      const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i')
      if ((m = re.exec(line))) push(li, m.index, `banned phrase: "${phrase}"`, 'AI filler. Rephrase or cut.')
    }

    for (const cr of extras.customRules ?? []) {
      if ((m = cr.re.exec(line))) push(li, m.index, `custom: ${cr.id}`, cr.suggestion ?? 'Site rule.')
    }
  })

  // Structural rules (markdown-aware, multi-line).
  if (rules.headingDependentOpener) {
    for (const v of headingDependentOpeners(text)) violations.push(v)
  }
  if (rules.demonstrativeHeading) {
    for (const v of demonstrativeHeadings(text)) violations.push(v)
  }

  return violations.sort((a, b) => a.line - b.line)
}

// A heading is a SUMMARY of its section: the prose never builds off it. This
// catches the mechanically detectable failure — a section whose FIRST sentence
// opens with a bare referring word whose antecedent can only be the heading.
// Precision beats recall: a referring word that re-names its subject in the
// same breath ("Both methods produce...") is connected prose and left alone.
const REFERRING = `it|it's|this|these|those|that|they|both|neither|such`
const BARE_VERB = `is|isn't|are|aren't|was|were|will|would|can|can't|could|should|shall|do|does|did|has|have|had|may|might|must|'s|'re`
const REFERRING_OPENER = new RegExp(`^(${REFERRING})(\\s+(${BARE_VERB})\\b|\\s*[.,;:!?])`, 'i')

export function headingDependentOpeners(md: string): Violation[] {
  const out: Violation[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,6}\s+(.+)/)
    if (!h) continue
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (!t) continue
      if (/^#{1,6}\s/.test(t) || /^(\||-|\*|\d+\.|>|```)/.test(t)) break
      if (REFERRING_OPENER.test(t)) {
        out.push({
          line: j + 1,
          rule: 'heading-dependent-opener',
          excerpt: t.slice(0, 80),
          suggestion: `Opens on a referring word whose antecedent is the heading ("${h[1].trim()}"). Re-name the subject.`,
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
  const lines = md.replace(/\r\n/g, '\n').split('\n')
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
        excerpt: line.trim().slice(0, 80),
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
    .map((v) => `- line ${v.line}: ${v.rule} ("${v.excerpt}")${v.suggestion ? ` — ${v.suggestion}` : ''}`)
    .join('\n')
}
