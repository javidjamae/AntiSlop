# Rules

## Implemented (deterministic tier)

| Rule ID | Fires on | NEUTRAL | STRICT |
|---|---|---|---|
| `unicode-bold` | Bold faked with unicode math characters | always | always |
| `engagement-bait` | Speech-bubble emoji leading into a question | always | always |
| `em-dash` | Em-dashes in prose | off | on |
| `ellipsis` | `…` or `...` for dramatic effect | off | on |
| `arrow-symbol` | `→ ⇒ ← 👉` standing in for words | on | on |
| `horizontal-rule` | `---` as a section divider | off | on |
| `banned opener: *` | `"Here's why"`, `"Let's dive in"`, `"In this article"`, at a sentence start | on | on |
| `banned phrase: *` | AI filler vocabulary (`delve`, `testament to`, `seamless`, and friends) | on | on |
| `contrast-slop` | Forward contrast flourish: negation immediately reasserted (`It's not luck. It's process.`) | off | on |
| `reversed-antithesis` | Trailing `", not X"` / `", never X"` closing a clause | off | on |
| `inline-header-bullet` | `- **Term:** sentence` bullet lists | off | on |
| `emoji-decoration` | Emoji decorating headings or bullets (©/®/™ exempt) | on | on |
| `bold-overuse` | 3+ bold spans in one paragraph (table rows exempt) | on | on |
| `heading-dependent-opener` | A section's first sentence opening on a bare referring word whose antecedent is the heading | on | on |
| `demonstrative-heading` | Non-question H2/H3 ending on a bare "it"/"this"/"that" | on | on |

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
