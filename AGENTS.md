# RecipeSage fork (lehons/recipesage) — agent rules

Personal customizations for Liohn's self-hosted RecipeSage (https://recipesage.sherbot.cloud).
Upstream: https://github.com/julianpoy/RecipeSage. Project data card and session state live in
`OneDrive - NDSCA\1-Projects\RecipeSage fork\` (AGENTS.md, agents-*.md).

## Prime directive: overlay, don't modify

Every customization must survive upstream updates with zero or trivial merge effort.

- **Never edit anything under `packages/`, root config files, Dockerfiles, or `docker-compose.yml`.** Upstream owns them.
- **All custom code lives in `overlay/`.** Upstream will never touch that folder, so syncing stays conflict-free.
- **Never build or deploy RecipeSage images from this fork.** Production keeps running the official `julianpoy/recipesage-selfhost` images. The overlay ships as its own small container/static bundle next to them.
- **Do not open PRs upstream.** Upstream does not accept AI-assisted contributions.

## Overlay tiers — classify every feature request before building

| Tier | What it is | Example | Verdict |
|---|---|---|---|
| T0 | Config or a deep link only | Link to a specific meal plan URL | Build |
| T1 | Injected UI (script/CSS added to the page, no upstream source change) | Bottom nav bar | Build; keep DOM coupling minimal |
| T2 | Standalone overlay page, same origin, calls the RecipeSage API | Quick-add shopping page | Build; isolate all API calls in one module |
| T3 | Requires changing upstream source, schema, or API | New field on recipes, changing the built-in shopping list page | **Push back.** Propose a T0–T2 alternative or drop it |

If a request is T3, or a T1/T2 build starts needing upstream internals (Angular components, private DOM structure, DB access), stop and push back to Liohn before writing code. Being conservative is the requirement, not a preference.

## Integration points (verified against upstream 2026-09-28, v4.0.13)

- Frontend is served under `/app/`, path-based routes (no hash):
  - Meal plan: `/app/meal-planners/<mealPlanId>`
  - Shopping list: `/app/shopping-lists/<shoppingListId>`
  - Recipes filtered by label: `/app/list/main?labels=<label title, URL-encoded>`
- Auth: the frontend stores the session token in `localStorage["token"]`. An overlay page served from the **same origin** can reuse it; no separate login.
- API: `/api/` (legacy REST) and tRPC (`packages/trpc/src/procedures/`). tRPC is internal, not a public contract — expect breakage on upgrades. Wrap every call in `overlay/*/api.*` so there is one place to fix.
- Shopping list items keep a `completed` flag until cleared; clearing deletes them.
- Selfhost stack: a `recipesage_proxy` nginx container fronts `static` and `api`. Script injection and `/overlay/` routing are done in front of that proxy (Traefik route + small nginx with `sub_filter`), never by altering upstream images.
- "Default" meal plan / shopping list / label do not exist upstream. They are IDs in overlay config.

## Deployment must be repeatable

- Every deploy step for the VPS lives in `overlay/deploy/DEPLOY.md` (deploy, update after upstream upgrade, roll back), plus the compose/Traefik/nginx files it references in `overlay/deploy/`.
- If you change anything on the server by hand, update `DEPLOY.md` in the same session. A deploy that only exists in shell history is not done.
- No secrets or real IDs in git. Real config goes in `overlay/config.json` (gitignored); `config.example.json` shows the shape.

## Tracking

Feature requests and triage: Asana project "RecipeSage fork" (GID `1218954036218771`). Tier prefix in task names (`[T0]`–`[T3]`). Reference the Asana task in commit messages.

## Branches

- `master` — pure mirror of upstream. Never commit here. Update with GitHub "Sync fork".
- `main` — `master` + `overlay/` + these agent files. Merge `master` into `main` after each sync.
- `feature/<short-name>` off `main` for all work; merge back when working.

## Upstream sync check

After merging `master` into `main`, re-verify the integration points above (routes, `localStorage["token"]`, the tRPC procedures the overlay calls). Update the "verified against" version line when done.
