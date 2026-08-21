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

## Measured detection

Generated text, paired with a human treatment of the same prompt so topic is
held constant. Documents with at least one finding:

| Profile | Human pair | Machine | Separation |
|---|--:|--:|--:|
| NEUTRAL | 5.1% | 23.6% | 18.5 points |
| STRICT | 19.6% | 33.2% | 13.6 points |

Per-rule lift, meaning the STRICT rate on machine text divided by the rate on
its human pair. Above 1 is the only evidence that a rule responds to
authorship rather than to subject matter.

| Rule | Lift | Reading |
|---|--:|---|
| `banned phrase` | 9.6x | The vocabulary list does nearly all of the detection work |
| `contrast-slop` | 1.7x | Real but modest |
| `em-dash` | 1.7x | Real but modest, and still too noisy on human prose to default on |
| `reversed-antithesis` | 0.4x | Fires MORE on human writing. A second, independent reason it defaults off |
| `ellipsis` | 0.1x | Fires ten times more on human writing |
| `invisible-unicode` | 0.0x | Model output is typographically clean. This rule catches a provenance problem rather than an authorship tell |
| `reveal-shape` | no hits | Fires on neither side. These corpora hold no content-marketing writing, which is the only register the shape appears in |

Every number here is a floor. The public paired corpora are 2022 and 2023
generators writing essays, news, and answers; none of them is the landing copy
where slop runs thickest. The markdown-structural rules cannot fire on
plain-text corpora at all and are judged on the table below instead.
[corpus/README.md](corpus/README.md) states the limits in full.

## Measured precision

Rates below are findings per 1,000 lines against 101,000 lines of human prose
pinned to revisions predating the generated web, under STRICT. Reproduce with
`npm run corpus`; method and sources are in [corpus/README.md](corpus/README.md)
and the current numbers in [corpus/REPORT.md](corpus/REPORT.md).

Read the two columns against each other. **Target** is technical documentation
and encyclopedic writing, the register this linter is pointed at. **Control**
is pre-1930 literary prose, included precisely because nobody would run a slop
linter on Moby Dick: a rule that is quiet on target and loud on control is
matching English rather than machine authorship, and belongs off by default.

| Rule | Target | Control | Default | Reading |
|---|--:|--:|---|---|
| `em-dash` | 4.09 | 37.88 | off | The control rate is a fact about Victorian typography, and the reason off is the only honest setting |
| `invisible-unicode` | 2.99 | 0.03 | always | Genuine hits, mostly U+00A0. A no-break space in running prose is an artifact worth seeing |
| `ellipsis` | 1.45 | 0.87 | off | Fires on enumeration and quoted ranges as much as on drama |
| `reversed-antithesis` | 1.22 | 2.77 | off | Most hits are content-bearing (`a JSON number, not a string`) |
| `banned phrase` | 0.82 | 0.51 | always | Concentrated in a few entries; the report names them |
| `contrast-slop` | 0.35 | 0.41 | off | Tightened against this corpus; see below |
| `inline-header-bullet` | 0.33 | 0.00 | off | A real pattern in edited human docs, which is why it is STRICT-only |
| `arrow-symbol` | 0.21 | 0.00 | on | Residual: multi-word pipeline stages defeat the capitalized-token exemption |
| `banned opener` | 0.21 | 0.00 | on | Rose from 0.02 once apostrophe straightening let `Here’s why` match |
| `heading-dependent-opener` | 0.19 | 0.00 | on | |
| `bold-overuse` | 0.05 | 0.00 | on | |
| `demonstrative-heading` | 0.02 | 0.00 | on | |
| `emoji-decoration` | 0.02 | 0.00 | on | |
| `reveal-shape` | 0.00 | 0.00 | on | No hits in 101,511 lines |

Every default-on rule sits at or below 0.21 per 1,000 lines on the target
register. `invisible-unicode` is higher and always on, and its hits are real.

Numbers here are pasted from a `npm run corpus` run, so
[corpus/REPORT.md](corpus/REPORT.md) is the source of truth if the two ever
disagree.

Notes the corpus produced:

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

- `contrast-slop` was tuned against the corpus rather than by eye, and both
  bounds cost something to find. Accepting the lexical auxiliaries on the
  negation side (`do not`, `doesn't`, `has not`) tripled the rate on human
  technical prose: `you do not need to set this field. It is automatically
  populated` negates an ACTION and then opens a new statement, which is not a
  reassertion. Only identity and possibility claims get reasserted, so the
  left side is copulas plus `can't`/`won't`/`cannot`. The boundary is
  sentence-final punctuation only, because the old class counted a semicolon
  and read the discourse marker `; that is,` as a reassertion. The right side
  stays a copula or auxiliary: matching a bare lexical verb (`The cache
  doesn't expire. It leaks.`) swallows ordinary two-sentence prose.
  Net against the previous rule set: three shapes gained, and the target-register
  rate is 0.35 per 1,000 (see the table above).

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
