# Rules

## Implemented (deterministic tier)

| Rule ID | Config key | Fires on | NEUTRAL | STRICT |
|---|---|---|---|---|
| `unicode-bold` | always on | Bold faked with unicode math characters | always | always |
| `engagement-bait` | always on | Speech-bubble emoji leading into a question | always | always |
| `invisible-unicode` | always on | Zero-width characters, soft hyphens, directional marks, nonstandard spaces, variation-selector runs, and the Unicode tag block: the character-level channel for watermarking, per-recipient fingerprinting, and prompt injection | always | always |
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
| `reveal-shape` | `revealShape` | The tease framing: `what nobody tells you`, `the part everyone skips`, `this is the thing everyone gets wrong`, `what they never mention`. Withholds the point, sells the withholding, and casts the reader as the one getting it wrong | on | on |

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

- `contrast-slop` accepts copula and auxiliary negations on the left
  (`isn't`, `doesn't`, `can't`, `cannot`) but requires a copula or auxiliary on
  the reassertion side. A bare lexical verb after the pronoun (`The cache
  doesn't expire. It leaks.`) is the same rhetorical shape and is left alone on
  purpose: matching any verb there swallows ordinary two-sentence technical
  prose, which is a worse trade than missing the hit. A token-list linter
  catches those two cases and pays for them elsewhere.

- `reveal-shape` keys on words that are ordinary in isolation (`part`,
  `everyone`, `most people`, `tells`), so each pattern requires the full
  tease construction rather than the trigger word. `The part number is on the
  case`, `Everyone can deploy to staging`, and `Nobody owns this table` stay
  clean; the test suite pins all three.

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

## Vocabulary packs

The default phrase list holds vocabulary with a low rate in human writing and
a high rate in generated text: `delve`, `tapestry`, `testament to`,
`let that sink in`. Those earn a default-on ban because flagging one is almost
always right.

A second tier exists and ships opt-in, as `PHRASE_PACKS.aggressive`:

```json
{ "phrasePacks": ["aggressive"] }
```

or `--pack=aggressive` for a one-off run. It holds `leverage`, `utilize`,
`comprehensive`, `foster`, `streamline`, `nuanced`, and their neighbors. Those
are ordinary professional English that models overuse. Banning them grades
writing QUALITY rather than flagging machine authorship, which is a voice
choice each repo makes rather than a default this linter imposes. Pack entries
honor `bannedPhrases.remove`, so a site can take the pack and keep one word.

Deliberately excluded from both tiers: bare intensifiers (`very`, `clearly`,
`obviously`) belong to a general prose linter, and prefix patterns such as
`quiet\w*` or `sharp\w*` fire on any sentence using an ordinary adjective. A
rule that noisy teaches writers to skim past the output, which costs more than
the tell it catches.

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
