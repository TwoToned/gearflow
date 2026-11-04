# Prototype kit

The files the clickable UX prototypes are assembled from (see
[`../ux-redesign-playbook.md`](../ux-redesign-playbook.md) §7). Vanilla HTML/JS, no
build, no dependencies beyond Playwright for the drive scripts.

```bash
# assemble a page (writes examples/jobs-prototype.html; the HTML is not committed)
node docs/designs/prototype-kit/assemble.mjs docs/designs/prototype-kit/examples/jobs "Jobs · RVLT Flow" Jobs jobs

# drive it (from the directory holding the HTML; proxy settings only matter in cloud sessions)
cd docs/designs/prototype-kit/examples && node ../drive/jobs-check.cjs jobs-prototype.html

# 2x screenshots for the user
node ../drive/shots.cjs .
```

`examples/` holds the page files of accepted prototypes (Jobs, Assets). Copy the
closest one for a new surface. The kit is excluded from ESLint (`eslint.config.mjs`)
because it is design scaffolding, not app code.
