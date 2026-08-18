# AntiSlop

[![ci](https://github.com/javidjamae/AntiSlop/actions/workflows/ci.yml/badge.svg)](https://github.com/javidjamae/AntiSlop/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/tag/javidjamae/AntiSlop?label=release)](https://github.com/javidjamae/AntiSlop/tags)
[![last commit](https://img.shields.io/github/last-commit/javidjamae/AntiSlop)](https://github.com/javidjamae/AntiSlop/commits/main)
[![license](https://img.shields.io/github/license/javidjamae/AntiSlop)](LICENSE)
![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

A humanization linter that helps you prevent writing AI slop (or human slop, for that matter).

AntiSlop checks prose for the mechanical tells of AI-generated writing: em-dash overuse, dramatic ellipses, arrow glyphs, "Let's dive in" openers, contrast flourishes, mechanical bolding, engagement bait, headings that point at nothing, and a curated list of AI filler vocabulary. It also catches hidden Unicode: zero-width characters, soft hyphens, directional marks, variation-selector runs, and the tag block used for steganography and invisible prompt injection. It is deterministic, dependency-free, and fast enough to run on every commit.

This README passes its own strict lint. Run `antislop --strict README.md` to check.

## Install

```bash
# as a project dependency (pin a tag)
pnpm add github:javidjamae/AntiSlop#v0.1.0

# or run without installing
npx github:javidjamae/AntiSlop file.md --strict
```

## CLI

```bash
antislop draft.md                 # neutral profile
antislop draft.md --strict        # every rule on
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
    "add": ["synergy", "best-in-class", "world-class"],
    "remove": ["robust"]
  },
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

`profile` sets the base, `rules` overrides per rule, and the phrase lists take either an `add`/`remove` object (edits the defaults) or a plain array (replaces them). `--strict` on the CLI overrides the config's profile; `--config=path` pins a config explicitly. The same shapes are available in the API through `resolveConfig()`.

One scoping note: a linter is the enforcement half of a voice, the list of things that never ship. The generative half, what your writing should sound like, belongs in your style guide and your prompts. Keep the style guide next to the config, and encode into the config only what a regex can actually hold.

## Profiles

- **NEUTRAL** keeps only the rules that rarely fire on legitimate human writing. Rules with a real false-positive tail on human prose (em-dash, ellipsis, the contrast rules, horizontal rules) stay off.
- **STRICT** turns everything on. Treat strict findings as prompts for a human read: the contrast rules in particular flag a construction that is decoration in one sentence and the entire point of the next. The test for each hit: delete the contrast, and if no information is lost, cut it.

Code blocks, inline code, blockquotes, and link URLs are always exempt. Quoted sources legitimately contain em-dashes, and API names legitimately contain words the vocabulary list bans.

## What this deliberately does not do

Only high-precision, mechanically detectable tells live here. Patterns that need a judgment call in context stay out of scope, because a regex that guesses at them trains writers to ignore the linter. See [RULES.md](RULES.md) for the full list of implemented rules and the explicit list of unmechanizable ones.

## Attribution

Several rules and the default vocabulary draw on Wikipedia's ["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) and on [blader/humanizer](https://github.com/blader/humanizer) (MIT).

## License

MIT
