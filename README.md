# AntiSlop

[![ci](https://github.com/javidjamae/AntiSlop/actions/workflows/ci.yml/badge.svg)](https://github.com/javidjamae/AntiSlop/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/tag/javidjamae/AntiSlop?label=release)](https://github.com/javidjamae/AntiSlop/tags)
[![last commit](https://img.shields.io/github/last-commit/javidjamae/AntiSlop)](https://github.com/javidjamae/AntiSlop/commits/main)
[![license](https://img.shields.io/github/license/javidjamae/AntiSlop)](LICENSE)
![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

A humanization linter that helps you prevent writing AI slop (or human slop, for that matter).

AntiSlop checks prose for the mechanical tells of AI-generated writing: em-dash overuse, dramatic ellipses, arrow glyphs, "Let's dive in" openers, contrast flourishes, mechanical bolding, engagement bait, headings that point at nothing, and a curated list of AI filler vocabulary. It also catches hidden Unicode: zero-width characters, soft hyphens, directional marks, variation-selector runs, and the tag block, which together form the character-level channel used to watermark text, fingerprint a copy back to its recipient, and smuggle invisible prompt injections. It is deterministic, dependency-free, and fast enough to run on every commit.

This README passes its own strict lint. Run `antislop --strict README.md` to check.

## Install

```bash
# as a project dependency (pin a tag)
pnpm add github:javidjamae/AntiSlop#v0.3.1

# or run without installing
npx github:javidjamae/AntiSlop#v0.3.1 file.md --strict
```

## CLI

```bash
antislop draft.md                 # neutral profile
antislop draft.md --strict        # every rule on
antislop draft.md --pack=aggressive  # add an opt-in vocabulary pack
antislop a.md b.md c.md --json    # machine-readable output
cat draft.md | antislop --strict  # stdin
```

Markdown frontmatter gets special treatment: the `title` and `description` fields are linted as their own surfaces, because AI tells leak into metadata more often than anyone checks. Exit code is 1 when anything fires and 0 when clean, so the CLI drops into a pre-commit hook or CI step as-is.

## API

```ts
import { lint, NEUTRAL, STRICT, format } from 'antislop'

const violations = lint(markdown, STRICT)
if (violations.length) console.log(format(violations))
```

`lint(text, rules?, bannedPhrases?)` returns `{ line, rule, excerpt, suggestion }` objects. Pass your own phrase list to replace the default vocabulary. Every rule is a boolean on the `RuleSet`, so any profile between `NEUTRAL` and `STRICT` is a spread away.

## Per-project voice: `antislop.config.json`

Drop an `antislop.config.json` at a repo's root and the CLI picks it up for any file under it, wherever the CLI was invoked from. This is how each site expresses its voice to the linter: which rules apply, which phrases are banned for this brand, which defaults it opts out of, and any site-specific patterns.

```json
{
  "profile": "strict",
  "rules": { "emDash": false },
  "bannedPhrases": {
    "add": ["circle back", "double-click on", "north star"],
    "remove": ["robust"]
  },
  "phrasePacks": ["aggressive"],
  "openers": { "add": ["picture this"] },
  "arrowExemptions": { "trailingCta": true },
  "customRules": [
    {
      "id": "no-passive-belief",
      "pattern": "\\bwe believe\\b",
      "suggestion": "State it as fact or attribute it."
    }
  ]
}
```

`rules` accepts either the camelCase key or the rule ID as printed in findings, so `"arrow-symbol": false` and `"arrows": false` are equivalent. An unrecognized name exits 2 with the list of valid ones rather than being ignored. `profile` sets the base, `rules` overrides per rule, and the phrase lists take either an `add`/`remove` object (edits the defaults) or a plain array (replaces them). `--strict` on the CLI overrides the config's profile; `--config=path` pins a config explicitly. The same shapes are available in the API through `resolveConfig()`.

`phrasePacks` opts into named vocabulary that stays out of the defaults. The `aggressive` pack bans `leverage`, `utilize`, `comprehensive`, `foster`, `nuanced`, and their neighbors: ordinary professional English that models overuse. Banning it grades writing quality rather than flagging machine authorship, so it belongs to a repo's voice rather than to every consumer of the linter. Pack entries still honor `bannedPhrases.remove`, and an unknown pack name exits 2 like an unknown rule.

One scoping note: a linter is the enforcement half of a voice, the list of things that never ship. The generative half, what your writing should sound like, belongs in your style guide and your prompts. Keep the style guide next to the config, and encode into the config only what a regex can actually hold.

## Profiles

- **NEUTRAL** keeps only the rules that rarely fire on legitimate human writing. Rules with a real false-positive tail on human prose (em-dash, ellipsis, the contrast rules, horizontal rules) stay off.
- **STRICT** turns everything on. Treat strict findings as prompts for a human read: the contrast rules in particular flag a construction that is decoration in one sentence and the entire point of the next. The test for each hit: delete the contrast, and if no information is lost, cut it.

Code blocks, inline code, blockquotes, and link URLs are always exempt. Quoted sources legitimately contain em-dashes, and API names legitimately contain words the vocabulary list bans.

## What it checks

Eight categories, seventeen rules. The **NEUTRAL** column is the default profile; every rule listed turns on under `--strict`. [RULES.md](RULES.md) carries the per-rule table, the config key for each, and the precision notes from sweeping the rules over a published corpus before they shipped.

| Category | Rules | Fires on | NEUTRAL |
|---|---|---|---|
| Typography | `em-dash`, `ellipsis`, `arrow-symbol`, `horizontal-rule` | `the fix — and there is one — is small`; `and then... silence`; `input → output` in a sentence; a `---` section divider | arrows only |
| Vocabulary | `banned phrase: *`, `banned opener: *` | `delve`, `seamless`, `testament to`, `in today's landscape`; a sentence starting `Let's dive in`, `Here's why`, or `In this article` | on |
| Contrast flourishes | `contrast-slop`, `reversed-antithesis` | `It's not luck. It's process.`; `not just fast, but correct`; `we ship weekly, not quarterly` | off |
| Formatting habits | `inline-header-bullet`, `bold-overuse`, `emoji-decoration` | `- **Speed:** users activate faster`; three or more bold spans in one paragraph; an emoji decorating a heading or bullet | bold and emoji only |
| Referent problems | `heading-dependent-opener`, `demonstrative-heading` | a section whose first sentence reads `This is where teams fail`; a heading reading `Getting Started With It` | on |
| Reveal framing | `reveal-shape` | `what nobody tells you`, `the part everyone skips`, `this is the thing everyone gets wrong`, `what they never mention` | on |
| Fake formatting and bait | `unicode-bold`, `engagement-bait` | bold faked with unicode math characters; a speech-bubble emoji leading into a question | always |
| Watermarks and fingerprints | `invisible-unicode` | zero-width characters, soft hyphens, directional marks, nonstandard spaces, variation-selector runs, and the Unicode tag block: the character-level channel that carries watermarks, per-copy fingerprints, and smuggled prompt injections | always |

The watermark row needs one scope note. What a linter can see is the character-level channel: codepoints that survive copy-paste and can carry a watermark, a per-recipient fingerprint, or a hidden instruction aimed at whatever model reads the text next. A variation-selector run is the giveaway shape, since encoded data has to be more than one character long. Statistical watermarks are a different mechanism and out of reach: token-sampling schemes bias which words a model picks, so they leave nothing on the page for a pattern matcher to find, and reading one requires the vendor's key. Any tool claiming to catch those by matching patterns is overclaiming. [RULES.md](RULES.md) states the boundary in full.

## How this compares

Prose linters already exist, and most of them aim at a different target. Vale, proselint, write-good, alex, and LanguageTool grade writing quality: passive voice, weasel words, readability, grammar, inconsiderate phrasing. A draft can score clean on all of them and still read as machine-written, because the tells sit on a separate axis from quality.

The tools aiming at the same target are the word-list linters (`slop-gate`, `slop-lint`) and the rule packs written for Vale (`Slopster`). Those cover the vocabulary layer well. AntiSlop adds the two layers a word list cannot reach: markdown structure spanning more than one line, and the raw code points underneath the text.

| | AntiSlop | Vale, proselint, write-good | slop-gate, Slopster | GPTZero, Originality.ai |
|---|---|---|---|---|
| Target | tells of machine authorship | writing quality and style-guide conformance | tells of machine authorship | probability a human wrote it |
| Detection layer | words, markdown structure, and code points | words and sentences | words and phrases | statistical classifier |
| Output | line, rule, and a suggested fix | line and rule | line and rule | a document-level score |
| Structural rules | heading referents, per-paragraph bold, frontmatter surfaces | style-dependent | no | no |
| Unicode watermarks and fingerprints | yes, including the tag block | no | no | no |
| Install footprint | Node 20, zero dependencies | Go binary plus style packages; Python; npm tree | zero-dep CLI; Vale plus Bun | hosted, mostly paid |
| Verdict on a person | never issues one | never issues one | never issues one | central to the product |

Three design choices follow from that.

Findings are deterministic rather than probabilistic. Each one names a rule and a location, so a writer can argue with it and win. AntiSlop makes no claim about who or what produced the text, which is what keeps it usable on your own drafts and keeps it from accusing anybody of anything.

Precision beats recall. Rules with a measured false-positive tail on human writing default off, and RULES.md publishes the tail next to the rule instead of hiding it. A rule that would need a judgment call stays unimplemented on purpose and gets listed as such.

Exemptions are context-aware. Code blocks, inline code, blockquotes, and link URLs are skipped, because quoted sources contain em-dashes and API names contain banned words. Arrows survive in breadcrumb paths and pipeline notation. Zero-width joiners survive inside emoji sequences and in Arabic, Persian, and Indic text, where they are real orthography.

## What this deliberately does not do

Only high-precision, mechanically detectable tells live here. Patterns that need a judgment call in context stay out of scope, because a regex that guesses at them trains writers to ignore the linter. See [RULES.md](RULES.md) for the full list of implemented rules and the explicit list of unmechanizable ones.

## Attribution

Several rules and the default vocabulary draw on Wikipedia's ["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) and on [blader/humanizer](https://github.com/blader/humanizer) (MIT).

The `reveal-shape` rule generalizes the families in [Slopster](https://github.com/t0ddharris/slopster)'s `Openers.yml` (MIT), and its `BannedWords.yml` contributed the social-post and puffery entries in the default vocabulary. The opt-in `aggressive` pack draws on the same project's `JargonSwaps.yml` and `WeakWords.yml`. Slopster ships as Vale rules and covers several of these families as fixed tokens; where the constructions generalize, AntiSlop implements them as regexes instead, and the entries that would fire on ordinary adjectives stay out.

## License

MIT
