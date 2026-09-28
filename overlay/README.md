# overlay/

All customizations to Liohn's RecipeSage instance live here. Rules: see `/AGENTS.md`.

## Planned layout

```
overlay/
  inject/        T1: overlay.js + overlay.css injected into /app/ pages (bottom bar)
  quick-add/     T2: standalone quick-add shopping page served at /overlay/quick-add
  config.example.json   IDs for default meal plan, shopping list, label (real config stays out of git)
  deploy/        Traefik labels + nginx sub_filter snippet for the VPS stack
```

Built: `inject/` (bottom bar), `deploy/` (overlay proxy + `DEPLOY.md`). Not yet built: `quick-add/`.

## Deployment model

```
Traefik ──► recipesage_overlay (nginx: sub_filter injects overlay.css + overlay.js)
               ├─ /overlay/*  → overlay static files
               └─ everything else → recipesage_proxy (official image, untouched)
```

Same origin is deliberate: overlay pages reuse the RecipeSage login token from `localStorage`.
