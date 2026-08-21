# Changelog

Releases are cut with `npm run release -- patch|minor|major`, which promotes
the Unreleased section, syncs `package.json` and `src/version.ts`, and tags,
all from one commit. The tag is the version consumers pin.

## Unreleased
- Fix (corpus harness): several ways the report could overstate its own
  coverage. A missing `corpus.lock.json` dropped every paired source and still
  exited 0, publishing a detection headline of `0.0% | 0.0% | 0.0 points`; it
  now exits 2. The cache was never pruned, so a lowered sample size or a
  renamed source left stale files to be counted by the next run. The lift
  column rendered "fires only on human text" identically to "never fired",
  which is what let a reveal-shape false-positive bug read as inert. Retries
  burned the full backoff ladder on 404s that could never succeed. Paged
  fetches could skip rows they never requested. And the generated prose
  hardcoded which rules scored below 1, in a report whose numbers are
  recomputed monthly.
- `npm run corpus:fetch` builds first; it imported `dist/` at module scope and
  died on a clean tree.

- Fix: `reveal-shape` fired on ordinary English. The subject family accepted a
  bare `people`/`they` and the verb family accepted a bare `says`/`knows`, so
  `the audit records what people say about the outage` was a finding, on a
  rule that defaults ON. The subject is now a universal quantifier
  (`nobody`/`everyone`/`most people`), which is what makes the construction a
  tease, and `tell` requires its object.
- Fix: every contraction-bearing rule was blind to the typographic apostrophe
  (U+2019). `It isn't a rewrite. It's a rename.` was a finding while the
  smart-quoted form was clean, and the same held for the reveal-shape,
  banned-opener and banned-phrase families. Since generated prose is
  smart-quoted far more often than plaintext corpora are, the rules that most
  need to read model output were the ones that could not. Apostrophes are now
  straightened before matching, which is index-preserving.
- Fix: nested banned-phrase entries double-reported one span. The
  `aggressive` pack bans bare `unleash` while the defaults ban
  `unleash the power of`, so six words produced two findings. Longest entry
  wins the span, once.


- New corpus harness (`npm run corpus`). Measures how often each rule fires on
  95,000 lines of human prose pinned to revisions predating the generated web,
  and writes `corpus/REPORT.md`. RULES.md previously claimed its rules had been
  swept over "a real published corpus" with no corpus in the repo; that claim
  is now a reproducible command and a table of measured rates. Corpus content
  is fetched at run time and stays out of the repo. A CI workflow publishes
  the report on every release. Report only, with no threshold: a gate would turn a judgment call
  into a merge blocker without improving the judgment.
- Fix: `contrast-slop` counted a semicolon as a sentence end, so the discourse
  marker `; that is,` read as a reassertion. The boundary is now
  sentence-final punctuation.
- The corpus caught the `contrast-slop` widening below over-firing on human
  technical prose, and the negation side was pulled back before release. See
  RULES.md.

- New rule `reveal-shape` (`revealShape`, on in NEUTRAL): the tease framing
  that withholds its point and sells the withholding, and casts the reader as
  the one getting it wrong.
  Examples: `what nobody tells you`, `the part everyone skips`,
  `this is the thing everyone gets wrong`.
  It survives rewording, so a phrase list does not reach it.
- Fix: `contrast-slop` missed the `do`/modal negations (`doesn't expire`,
  `don't help`, `can't tune`, `cannot preempt`) and past-copula reassertions
  (`It was a rename`), because both sides of the pattern accepted only
  `is|are|was|were`. A bare lexical verb after the pronoun (`It leaks.`) stays
  unmatched on purpose; RULES.md states the limit.
- Default vocabulary gains the social-post and puffery tier:
  `let that sink in`, `read that again`, `imagine a world where`,
  `in the realm of`, `paradigm shift`, `unleash the power of`,
  `at the end of the day`, `best-in-class`, `world-class`,
  `next-generation`, and the `in today's` variants.
- New opt-in vocabulary packs. `"phrasePacks": ["aggressive"]` in config, or
  `--pack=aggressive` on the CLI, appends a second tier (`leverage`,
  `utilize`, `comprehensive`, `foster`, `nuanced`) that is ordinary
  professional English rather than a machine-authorship tell, so it stays out
  of the defaults. An unknown pack name exits 2, matching the unknown-rule
  behavior. Pack entries honor `bannedPhrases.remove`.
- Attribution added for [Slopster](https://github.com/t0ddharris/slopster)
  (MIT), the source of the reveal-shape families and much of the new
  vocabulary.

- Fix: an unrecognized key in the config's `rules` map was silently ignored, so
  a config written from the printed rule IDs (`reversed-antithesis` rather than
  `reversedAntithesis`) looked applied, changed no exit code, and left the rule
  on. Rule IDs are now accepted as aliases for their config keys, and a name
  that is neither exits 2 listing the valid ones. Several keys are not a
  mechanical conversion of their ID (`arrow-symbol` is `arrows`,
  `horizontal-rule` is `hrDivider`), so RULES.md now carries a config-key
  column beside each rule ID.

## 0.3.1 (2026-08-18)

- Fix: the `exports` map declared only an `import` condition, so resolvers
  that take the CJS path (bundlers, ts runners) failed with
  ERR_PACKAGE_PATH_NOT_EXPORTED even though the package loads fine as ESM.
  Now declares `default`.
- Export `VERSION` from the package entrypoint so consumers can read the
  linter version they are pinned to. It was reachable only from the CLI.

- Fix: `arrow-symbol` no longer flags unrelated emoji. The rule's character
  class held the pointing-hand emoji without the `u` flag, so it matched
  either half of that astral character's surrogate pair, silently reporting
  every emoji sharing the U+D83D high surrogate (roughly U+1F400-U+1F6FF,
  including the rocket, link, skull, camera and grin emoji) as an arrow, and
  double-reporting the hand itself. The
  class is now `u`-flagged and BMP-only; the pointing hand is an emoji and
  belongs to `emoji-decoration`, which already caught it.

## 0.3.0 (2026-08-18)

- `contrast-slop` catches all four forward shapes: negation reasserted across
  a sentence boundary, the comma form ("it's not X, it's Y"),
  "not just X, but Y", and negation + dramatic consequence. Overlapping
  patterns report once per span.
- `arrow-symbol` exempts universal documentation conventions: breadcrumb/menu
  paths and pipeline notation (Capitalized tokens on both sides of a `→`) and
  leading `←` back-links. The trailing-`→` link CTA is per-site: opt in via
  `arrowExemptions.trailingCta`.
- CI workflow (tests on Node 20/22 + the docs' own strict lint) and the README
  badge row.
- `--version` flag on the CLI.
- Release tooling: `npm run release`, this changelog, and a release workflow
  that attaches an install-anywhere tarball to each GitHub Release.

## 0.2.0 (2026-08-18)

- `invisible-unicode` rule (always on): zero-width characters, soft hyphens,
  directional marks, nonstandard spaces, variation-selector runs, and the
  Unicode tag block. Ignores code/quote exemptions on purpose; carve-outs for
  emoji ZWJ sequences, emoji presentation selectors, joiner-script
  orthography, and a file-initial BOM.
- Per-project voice config (`antislop.config.json`, auto-discovered): profile,
  per-rule overrides, banned-phrase add/remove or replace, opener edits, and
  custom regex rules.

## 0.1.0 (2026-08-18)

- Initial release: 15 deterministic rules, NEUTRAL/STRICT profiles, char-level
  skip mask (code, quotes, link URLs), frontmatter title/description linted as
  separate surfaces, CLI with file/stdin input, `--json`, and hook-ready exit
  codes.
