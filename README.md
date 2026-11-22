# swift-site

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/nmlyz/swift-site/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/nmlyz/swift-site/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast static site generator for Node 22. It takes one site description —
`{ site, templates, files }` — and builds the whole output tree: each page's
`index.html`, the index and tag pages, `build-report.txt`, and the static
files, all as plain text.

## What it does

- Reads Markdown sources with a small front-matter block (`title`, `date`,
  `tags`, `draft`, `layout`, `slug`, `summary`), refusing sources whose
  front matter does not read.
- Renders a Markdown subset: ATX headings with unique ids, fenced code,
  thematic breaks, blockquotes, flat lists and paragraphs, with inline code,
  strong, emphasis and links.
- Expands a small template dialect: `{{ path }}` (escaped) and
  `{{{ path }}}` (raw), `{% for x in path %}` with `loop.index` / `first` /
  `last` / `length`, `{% if path %}` / `{% if not path %}` with an optional
  `{% else %}`, and `{% include "name" %}` up to 8 deep.
- Builds permalinks from titles or explicit slugs, unique per directory,
  groups posts into a newest-first collection with newer/older neighbours,
  groups posts by tag, paginates the index, and writes a build report
  listing refused sources, drafts, broken links and shadowed files.

## Running it

`main.ts` reads `/input/cases.json` (an array of `{ id, input }`), answers
each case with `run` from `solve.js`, and writes `/output/answers.json`.
Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in
for `/input` and `/output`.

`solve.js` is a dependency-free ES module. `run(input)` returns the output
tree: an object mapping each output path to that file's text. The build is
deterministic: running it twice on the same input gives byte-identical
output.

## Layout

- `solve.js` — the whole generator.
- `main.ts` — the driver that reads cases and writes answers.
- `LICENSE` — MIT.
