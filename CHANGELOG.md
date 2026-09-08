# Changelog

Releases are cut with `npm run release -- patch|minor|major`, which promotes
the Unreleased section, syncs `package.json` and `src/version.ts`, and tags,
all from one commit. The tag is the version consumers pin.

## Unreleased

_Nothing yet._

## 0.6.0 (2026-09-08)

### Fixed

- A leading byte-order mark no longer silences the heading rules. A BOM is an
  encoding marker that Windows editors and many export pipelines emit, and it
  sat in front of the first character of line 1, so `## Heading` stopped
  matching `^##` and a document opening with a heading, which is most
  documents, quietly lost `heading-dependent-opener` and
  `demonstrative-heading` on it. `invisible-unicode` deliberately does not
  report a BOM at file start, so nothing else caught it either. Only the
  leading one is stripped: a BOM mid-document is an artifact and still reports.

### Added

- `stripBom(s)` is exported alongside `straighten(s)`, so a host normalizing
  input before handing it over can apply what `lint()` applies.
- A contract and fixture test layer, 29 cases over what the package ships.
  Property tests quantify over the shipped lists rather than restating them, so
  an edit to a list is checked by the tests that already exist: every phrase
  must fire in either apostrophe spelling, every rule that can fire must have a
  severity entry and vice versa, and both spellings of a rule name must resolve
  to the same rule. An encoding matrix runs every rule against smart quotes,
  CRLF, a BOM and a trailing newline, which is what found the BOM bug above. A
  config matrix covers the surface that had none: every option proven to take
  effect, and a plausible typo of each proven to be refused.

  The measured corpus cannot do this job, which is why it never caught any of
  it. Five of the eighteen rules never fire on that corpus, it holds no
  configuration at all, and a sweep over found text covers what writers
  happened to write rather than what changed.

## 0.5.0 (2026-09-08)

### Added

- Rule severity: `error`, `warn`, `info`. Findings carry a `severity`, and the
  CLI gains `--fail-on=error|warn|info|never` to choose which levels decide the
  exit code. Set per rule through a new `severities` map in
  `antislop.config.json`, which takes either spelling of a rule name and also
  applies to the always-on rules (they still cannot be disabled).
- `--json` output gains `failing`, `failOn`, and a `counts` breakdown by level,
  so a host scoring findings reads the weight off the finding instead of
  maintaining its own table. ([#22](https://github.com/javidjamae/AntiSlop/issues/22))
- Two config keys are exempt from that check, because JSON has no slot for
  either and config formats grow conventions to fill the gap: `$schema`, which
  is how an editor offers completion, and any key beginning with `//`, which is
  a note to the next reader. A `//` key works at the top level and inside
  `rules` and `severities`, where the decisions worth annotating live. Both are
  declared on `AntislopConfig`, so a consumer generating a config in TypeScript
  can write them too.
- `straighten(s)` is exported: the apostrophe fold `lint()` applies before
  matching. It is exported so configuring and matching cannot drift apart
  again, which is what the removal bug below came from, and it is available to
  a host that normalizes text before handing it over.
- `Object.keys(DEFAULT_SEVERITY)` is the rule-ID list, which lets a consumer
  drift-test the always-on rules that no `RuleSet` toggle can reach.
  `DEFAULT_SEVERITY` has a null prototype, so an inherited member name misses
  instead of returning a function that would silently never gate. Every normal
  access still works, including `Object.keys`, `in`, spread, `JSON.stringify`
  and `Object.hasOwn`. Calling `DEFAULT_SEVERITY.hasOwnProperty(...)` on it
  does not; use `Object.hasOwn(DEFAULT_SEVERITY, id)`.

### Fixed

- `bannedPhrases.remove` and `openers.remove` now take, whichever apostrophe
  either side is typed with. `lint()` straightens the text and the phrase list
  before matching, but `resolveConfig` compared raw strings, so removing
  `in today's landscape` left its smart-quoted twin in the list and the phrase
  kept firing on both spellings. A `remove` entry typed with the smart quote a
  macOS text field produces matched nothing at all. The removal looked applied
  and silently was not. ([#25](https://github.com/javidjamae/AntiSlop/issues/25))
- `DEFAULT_BANNED_PHRASES` no longer ships apostrophe twins: 76 entries become
  72. Matching straightens the list, so the four smart-quoted duplicates never
  caught anything their straight spellings missed. Both spellings still fire,
  because the text is straightened too. A consumer reading the list sees each
  phrase once, and so does anyone counting them.
- Resolved phrase and opener lists are deduped, so a `remove` that misses
  cannot be masked by a second copy.
- A `customRules` pattern is straightened too, so a rule typed with a smart
  apostrophe fires instead of silently never matching.
- A misspelled key inside `bannedPhrases`, `openers` or `arrowExemptions` now
  throws, the way a misspelled top-level key already did. Writing `remvoe` for
  `remove` used to resolve clean and leave the phrase firing.
- A blank phrase entry is dropped rather than compiled. `""` became `\b\b`,
  which matches every non-empty line, so one stray comma in a hand-edited array
  buried every real finding under a finding on all of them.
- `headingDependentOpeners` and `demonstrativeHeadings` straighten their own
  input. They are public exports and their patterns are contraction-bearing, so
  a host calling them directly on smart-quoted prose got nothing back. `lint()`
  was unaffected, since it straightens first.

### Changed

- **An unrecognized `--flag` is now a usage error (exit 2).** It used to be
  ignored, so `--failon=never` printed the findings and still failed the run
  while the author believed gating was off. A pipeline carrying a stale or
  misspelled flag starts failing on upgrade, which is the point: it was never
  doing what it said.
- **An unknown top-level key in `antislop.config.json` now throws (exit 2),**
  and so does a misspelled key inside `bannedPhrases`, `openers` or
  `arrowExemptions`. `severity` for `severities` used to resolve to nothing and
  leave the run gating. `$schema` and `//` keys are exempt.
- Human-readable output prints the level per finding, as `[error]` before the
  rule name. The summary line gains a breakdown only when a run is not
  all-`error`, so an ordinary run reads as it did before. `--json` is the stable surface for
  anything parsing output.

**Severity changes no exit code on its own.** Every rule that ships declares
`error` and the default threshold is `error`, so the same runs pass and the same
runs fail. Severity is opt-in. Verified across 338 runs against v0.4.0, over the
whole pinned corpus in both profiles: no finding and no exit code moves.

That guarantee covers severity. It does not cover the stricter input checks
below, which are the part of this release that can fail a setup that used to
pass. Read those before upgrading a pipeline.

Note one consequence once a rule IS moved below the threshold: exit 0 stops
meaning "no findings" and starts meaning "nothing at or above the threshold".
Printed output stays honest, since every finding is reported whatever its level
and the summary breaks down the counts, but anything reading only the exit code
cannot tell the two apart. Report a clean run with the threshold it ran at.

What else changes for everyone is the human-readable output above: each finding
now carries a `[level]` prefix. Anything parsing stdout will see it. `--json`
is the surface to parse, and it gained fields rather than changing any.

## 0.4.0 (2026-08-21)

Upgrading from 0.3.1 will surface MORE findings on prose that previously
passed, for three reasons: a new rule that defaults on, about fifteen new
vocabulary entries, and apostrophe handling that lets the existing rules see
text they were blind to. None of that is a false-positive increase; the
measured rate on human prose is in RULES.md.

### Added

- New rule `reveal-shape` (config key `revealShape`, on in NEUTRAL). The tease
  framing that withholds its point and sells the withholding, and casts the
  reader as the one getting it wrong.
  Examples: `what nobody tells you`, `the part everyone skips`,
  `this is the thing everyone gets wrong`.
  It survives rewording, so a phrase list does not reach it. Generalized from
  [Slopster](https://github.com/t0ddharris/slopster)'s `Openers.yml` (MIT).
- Default vocabulary gains the social-post and puffery tier:
  `let that sink in`, `read that again`, `imagine a world where`,
  `in the realm of`, `paradigm shift`, `unleash the power of`,
  `at the end of the day`, `best-in-class`, `world-class`,
  `next-generation`, and the `in today's` variants.
- Opt-in vocabulary packs. `"phrasePacks": ["aggressive"]` in config, or
  `--pack=aggressive` on the CLI, appends a second tier (`leverage`,
  `utilize`, `comprehensive`, `foster`, `nuanced`). Those are ordinary
  professional English that models overuse, so banning them grades writing
  QUALITY rather than flagging machine authorship. That is a per-repo voice
  choice, which is why it stays out of the defaults. An unknown pack name
  exits 2. Pack entries honor `bannedPhrases.remove`.
- `PHRASE_PACKS` and `AGGRESSIVE_PHRASES` are exported from the entrypoint.
- A corpus harness, `npm run corpus`. It measures how often each rule fires on
  101,000 lines of human prose pinned to revisions predating the generated
  web, and on generated prose paired with a human treatment of the same
  prompt. RULES.md previously claimed its rules had been swept over "a real
  published corpus" with no corpus in the repo; that claim is now a
  reproducible command and a table of measured rates. Corpus content is
  fetched at run time and never committed. The report publishes to GitHub
  Pages, to each release as an asset, and to a monthly draft PR that refreshes
  the copy in the repo. Report only, with no threshold: a gate would turn a
  judgment call into a merge blocker without improving the judgment.

### Changed

- `contrast-slop` was retuned against that corpus rather than by eye. It now
  catches modal negations (`can't`, `won't`, `cannot`) and past-copula
  reassertions (`It was a rename`), which it previously missed. It deliberately
  does NOT accept lexical-auxiliary negations (`you do not need to set this
  field. It is automatically populated` negates an action and then opens a new
  statement), because accepting them tripled the rate on human technical prose.
- Apostrophes are straightened before matching. Every contraction-bearing rule
  was blind to U+2019, so `It isn't a rewrite. It's a rename.` was a finding
  while the smart-quoted form was clean. Generated prose is smart-quoted far
  more often than plaintext corpora are, so the rules that most need to read
  model output were the ones that could not. The transformation is
  index-preserving, so reported offsets are unchanged.
- Nested banned-phrase entries report once per span. The `aggressive` pack
  bans bare `unleash` while the defaults ban `unleash the power of`, so six
  words used to produce two findings. The longer entry wins.
- Published tarballs no longer contain `dist/index.test.js`. `files: ['dist']`
  had been taking the whole directory.

### Fixed

- An unrecognized key in the config's `rules` map was silently ignored, so a
  config written from the printed rule IDs (`reversed-antithesis` rather than
  `reversedAntithesis`) looked applied, changed no exit code, and left the rule
  on. Rule IDs are now accepted as aliases for their config keys, and a name
  that is neither exits 2 listing the valid ones. Several keys are not a
  mechanical conversion of their ID (`arrow-symbol` is `arrows`,
  `horizontal-rule` is `hrDivider`), so RULES.md now carries a config-key
  column beside each rule ID.
- `contrast-slop` counted a semicolon as a sentence end, so the discourse
  marker `; that is,` read as a reassertion. The boundary is now
  sentence-final punctuation only.
- `npm run release` never updated the two install pins in the README, so
  cutting a version left both snippets pointing at the previous one. Nothing
  caught it, because the old tag resolves and installs fine.

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
