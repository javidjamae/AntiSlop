# Changelog

Releases are cut with `npm run release -- patch|minor|major`, which promotes
the Unreleased section, syncs `package.json` and `src/version.ts`, and tags,
all from one commit. The tag is the version consumers pin.

## Unreleased

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
