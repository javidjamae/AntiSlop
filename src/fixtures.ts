// Engineered inputs, one minimal trigger per shipped rule.
//
// These exist because the measured corpus cannot do this job. That corpus is
// found human and machine prose, fetched rather than committed (see
// .gitignore), and it is the right instrument for what it is for: measuring how
// often a rule fires on real writing, which is what justifies a default.
//
// It is the wrong instrument for regression. Two reasons, neither fixable by
// adding documents. Five of the eighteen rules never fire on it at all, so a
// change to any of them is invisible to a corpus sweep. And a sweep over found
// text covers what writers happened to write, not what we changed: a third of
// that corpus carries smart quotes, yet none of it carries the four smart-quoted
// phrases whose removal in v0.5.0 needed checking, so a 338-run differential
// came back clean while being silent on the only question being asked.
//
// A fixture is written to trip exactly one rule so a change to that rule cannot
// hide behind another rule's finding on the same text.
export const RULE_TRIGGERS: Record<string, string> = {
  'unicode-bold': '\u{1D400}\u{1D401} bold text here',
  'engagement-bait': '\u{1F4AC} What do you think?',
  'invisible-unicode': 'war​plan text',
  'em-dash': 'A sentence — with a dash.',
  ellipsis: 'Well... maybe so.',
  'arrow-symbol': 'this leads → that',
  'horizontal-rule': 'Above.\n\n---\n\nBelow.',
  'contrast-slop': "The gap is not luck. It's process failure.",
  'reversed-antithesis': 'The demo is that system, live, not a deck about it.',
  'inline-header-bullet': '- **Bold lead:** a bullet that fakes a header',
  'emoji-decoration': '## \u{1F680} A heading',
  'bold-overuse':
    '**one** **two** **three** **four** **five** **six** **seven** **eight**',
  'heading-dependent-opener': '## Training the blog\n\nThis is where it learns.\n',
  'demonstrative-heading': '## Three ways to run that\n',
  'reveal-shape': 'What nobody tells you about this.',
  'banned-opener': "Here's why this matters.",
  'banned-phrase': 'This API is robust.',
  custom: 'a zzprobezz here',
}

/**
 * Triggers whose match runs to END OF LINE, where a stray `\r` sits.
 *
 * The encoding matrix passed over CRLF for a while without testing it: every
 * entry above ends in punctuation, so no match reached the line ending and the
 * `\r` never entered a bounded character class. These do, and they are the
 * shapes that actually broke.
 */
export const EOL_SENSITIVE: Record<string, string> = {
  'reversed-antithesis': '(a JSON number, not a\nstring)',
  'contrast-slop': "It's not a tool problem, it's a\nstandards problem",
}

/** The id the `custom` trigger above is registered under. */
export const CUSTOM_PROBE = { id: 'zzprobe', pattern: 'zzprobezz' }

/**
 * Ways the same prose can be encoded without changing what it says. A rule that
 * fires on one spelling and not another is a rule that works in the test suite
 * and fails on real input, since real input is whatever the author's editor
 * produced.
 *
 * Each entry rewrites text without changing which rule should fire. NBSP is
 * deliberately absent: substituting it is not encoding-neutral, because
 * `invisible-unicode` exists to report it.
 */
export const ENCODINGS: Record<string, (s: string) => string> = {
  'as written': (s) => s,
  'smart apostrophes': (s) => s.replace(/'/g, '’'),
  'CRLF line endings': (s) => s.replace(/\n/g, '\r\n'),
  'leading BOM': (s) => `﻿${s}`,
  'trailing newline': (s) => (s.endsWith('\n') ? s : `${s}\n`),
}
