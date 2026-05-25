# Contributing to SenseMap

Thanks for your interest in contributing. SenseMap is an open-source project built to help autistic and sensory-sensitive individuals find comfortable public spaces.

---

## Workflow

The `main` branch is protected — direct pushes are blocked. All changes go through a pull request.

```bash
# 1. Fork and clone (external contributors)
git clone https://github.com/Rohan-08-12/SenseMap.git
cd SenseMap/AutisticAI

# 2. Create a branch
git checkout -b fix/describe-your-change
# or
git checkout -b feat/describe-your-feature

# 3. Make your changes, then commit
git add <files>
git commit -m "short description of what and why"

# 4. Push and open a PR
git push origin fix/describe-your-change
gh pr create --fill
```

Branch naming:
- `feat/` — new feature
- `fix/` — bug fix
- `chore/` — tooling, deps, config
- `docs/` — documentation only

---

## Local setup

See [README.md](./AutisticAI/README.md) for full setup instructions including environment variables, seeding, and running the dev servers.

---

## Project structure

```
SenseMap/AutisticAI/
├── frontend/     # React 19 + Vite
├── backend/      # Express 5 + Prisma + PostgreSQL
└── DOCS.md       # Full API and architecture docs
```

---

## Guidelines

- **No TypeScript** — plain JavaScript + JSX throughout
- **Autism-friendly UX** — soft colors, minimal animation, generous spacing; avoid jarring transitions or dense layouts
- **Sensory scores are 1–10** — lower = less stimulating (quieter, dimmer, less crowded)
- **Call `recalculateScores()`** after any review create or update (`backend/src/lib/scores.js`)
- **Protected routes** use `requireAuth` + `syncUser` middleware; public routes use `optionalAuth` or no auth
- Keep PRs focused — one fix or feature per PR

---

## Reporting bugs

Open an issue on GitHub with steps to reproduce, expected behavior, and actual behavior. Screenshots or console errors are helpful.
