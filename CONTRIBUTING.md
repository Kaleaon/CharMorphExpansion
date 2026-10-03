# Contributing

## Clean-room rule
The code under `legacy/` is GPL-3.0 and its data is partly AGPL-3.0. **Do not copy code, data,
meshes, or morph targets from `legacy/`, MB-Lab, Ruth2/Roth2 (AGPL-3.0), or any other
copyleft source into the new app.** Reading them to understand ideas is fine; implementing the
ideas from scratch is fine.

## Assets
- Allowed: `CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0` (and `MIT`/`Apache-2.0`/`BSD-*`/`ISC` for bundled data files).
- Not allowed in `assets/`: GPL/AGPL/LGPL, CC-BY-SA, any NC/ND, unknown or unstated licenses.
- Every pack directory under `assets/` has a `MANIFEST.json` listing *every* file with source URL,
  author, SPDX license, attribution text and SHA-256. Run `pnpm license-gate`.

## Second Life data
`avatar_skeleton.xml` / `avatar_lad.xml` come from the LGPL-2.1 Second Life viewer. They are
**not** committed to `assets/`; `tools/import-sl-skeleton` (M2) fetches them at build time and
generates derived tables.
