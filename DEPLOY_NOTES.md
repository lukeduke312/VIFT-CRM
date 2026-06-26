# Deploy Notes

## Source of truth

GitHub Pages serves from the **root** of the `gh-pages` branch.

- Edit files in `/src/` (root)
- Bump versions in root `/index.html`
- Do NOT edit `/vift-system/src/` — it is a stale copy

## Version bumping

When editing a file, bump its `?v=N` in `/index.html`:
- `src/pages/PageShells.js` → bump `PageShells.js?v=N`
- `src/styles/components.css` → bump `components.css?v=N`

## Deploy

Commit on `gh-pages` branch and push to `origin gh-pages`.
GitHub Pages rebuilds automatically (1–3 min).
