# Rules

## Implemented (deterministic tier)

| Rule ID | Config key | Fires on | NEUTRAL | STRICT |
|---|---|---|---|---|
| `unicode-bold` | always on | Bold faked with unicode math characters | always | always |
| `engagement-bait` | always on | Speech-bubble emoji leading into a question | always | always |
| `invisible-unicode` | always on | Zero-width characters, soft hyphens, directional marks, nonstandard spaces, variation-selector runs, and the Unicode tag block (a documented steganography and prompt-injection channel) | always | always |
| `em-dash` | `emDash` | Em-dashes in prose | off | on |
| `ellipsis` | `ellipsis` | `…` or `...` for dramatic effect | off | on |
| `arrow-symbol` | `arrows` | `→ ⇒ ←` standing in for words (emoji belong to `emoji-decoration`). Universal doc conventions are exempt: breadcrumb/menu paths and pipeline notation (Capitalized tokens on both sides of a `→`) and a leading `←` back-link. A trailing `→` link CTA is a per-site convention: opt in via `arrowExemptions.trailingCta` | on | on |
| `horizontal-rule` | `hrDivider` | `---` as a section divider | off | on |
| `banned opener: *` | `bannedOpeners` | `"Here's why"`, `"Let's dive in"`, `"In this article"`, at a sentence start | on | on |
| `banned phrase: *` | always on | AI filler vocabulary (`delve`, `testament to`, `seamless`, and friends) | on | on |
| `contrast-slop` | `contrastSlop` | Forward contrast flourish in four shapes: negation reasserted (`It's not luck. It's process.`), the comma form (`it's not X, it's Y`), `not just X, but Y`, and negation + dramatic consequence. Overlaps report once per span | off | on |
| `reversed-antithesis` | `reversedAntithesis` | Trailing `", not X"` / `", never X"` closing a clause | off | on |
| `inline-header-bullet` | `inlineHeaderBullets` | `- **Term:** sentence` bullet lists | off | on |
| `emoji-decoration` | `emojiDecor` | Emoji decorating headings or bullets (©/®/™ exempt) | on | on |
| `bold-overuse` | `boldOveruse` | 3+ bold spans in one paragraph (table rows exempt) | on | on |
| `heading-dependent-opener` | `headingDependentOpener` | A section's first sentence opening on a bare referring word whose antecedent is the heading | on | on |
| `demonstrative-heading` | `demonstrativeHeading` | Non-question H2/H3 ending on a bare "it"/"this"/"that" | on | on |

Precision notes, from sweeping the rules over a real published corpus before
they shipped anywhere:

- `reversed-antithesis` fires on roughly half of typical technical articles,
  and most hits are content-bearing distinctions (`a JSON number, not a
  string`). That is why it defaults off and why its advice is the
  delete-the-contrast test per hit; a bulk fix is wrong by design.
- `demonstrative-heading` exempts question headings (natural FAQ phrasing
  carries its antecedent in-heading: "Can I use the tool without installing
  it?") and plural pronouns (compound headings carry the antecedent: `Common
  Frame Rates and When to Use Them`). Known residual false positive: a
  mid-heading antecedent (`Replace audio with silence instead of removing
  it`), which needs parsing rather than a regex.

- `invisible-unicode` deliberately ignores the code/quote exemptions the other
  rules honor: a hidden character inside a code block is more suspicious, not
  less. Carve-outs for legitimate uses: ZWJ inside emoji sequences, a single
  VS15/16 giving an emoji or keycap its presentation, ZWNJ/ZWJ adjacent to
  scripts where they are real orthography (Arabic, Persian, Indic), and a
  byte-order mark at file position 0.

## Configuring a rule

The **Config key** column is what `antislop.config.json` takes in its `rules`
map. Several keys are not a mechanical conversion of the rule ID, so the linter
also accepts the rule ID itself as an alias: `"arrow-symbol": false` and
`"arrows": false` both work. An unrecognized name exits 2 with the list of
valid names rather than being silently ignored, because a config that looks
applied while doing nothing is the worst outcome available here.

## What this cannot detect, stated plainly

Statistical watermarks (token-sampling schemes such as green-list/red-list
bias) leave nothing on the page for any linter to match. Detection requires
the vendor's key and operates on probability distributions rather than
characters.
Any tool claiming to catch them with pattern matching is overclaiming. What
`invisible-unicode` does catch is the character-level channel: hidden
codepoints that survive copy-paste and can carry fingerprints or smuggled
instructions.

## Explicitly unmechanizable (judgment tier)

The patterns below are real tells, and they stay out of scope on purpose.
Each needs to be separated from legitimate craft by reading in context, and a
regex that guesses trains writers to ignore the linter.

- Rule-of-three cadence used for rhythm rather than enumeration
- Significance inflation beyond the fixed phrase list
- `-ing` participial padding (`, showcasing` / `, highlighting` tails)
- Copula avoidance ("serves as", "stands as" replacing "is")
- False ranges ("from X to Y" where X and Y are not a real scale)
- Ambiguous "this"/"that" in running prose (the heading-anchored case IS
  implemented; the general case needs a semantic read for decoy antecedents)
- A definite article introducing an undefined entity ("the system", before
  any system has been named)
- Uniform paragraph architecture and section-final epigram runs
- Hedging everything / contraction avoidance
