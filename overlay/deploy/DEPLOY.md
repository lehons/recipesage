# Overlay deploy runbook — recipesage.sherbot.cloud

Every server-side step for the overlay lives here. If you change anything on the VPS by hand,
update this file in the same session.

## Topology

```
Traefik ──(router recipesage-overlay, priority 50)────► recipesage_overlay (nginx, this repo)
                                                          ├─ /overlay/*  → bind-mounted overlay files
                                                          ├─ /app/<route> 404 → app index (deep-link fallback)
                                                          └─ everything else → recipesage_proxy (unchanged)
Traefik ──(router recipesage, default priority)─────────► recipesage_proxy   (fallback when overlay is down)
```

- Router priorities on this host: `recipesage-mcp` + `recipesage-mcp-oauth` (`/mcp`, OAuth paths) = 100,
  overlay = 50, base `recipesage` = default (rule length, 32). The overlay must stay between them,
  or it swallows the MCP server's routes (happened on first deploy with priority 1000).
  Verification includes an MCP route check.
- The base stack in `/docker/recipesage/` is not touched by this deploy. Its Traefik router stays in
  place, so stopping the overlay stack sends traffic straight back to it.
- HTML responses get two tags injected before `</head>`: `overlay.css` and `overlay.js` (ES module).
- `config.json` (real IDs) lives only on the VPS at `/docker/recipesage-overlay/config.json`.
  It is served publicly at `/overlay/config.json`. The IDs aren't secrets because the API
  still requires a login and access to the list, but don't put anything sensitive in it.

| Path on VPS | What |
|---|---|
| `/docker/recipesage-overlay/repo/` | Sparse clone of `lehons/recipesage` (`overlay/` only), branch `main` |
| `/docker/recipesage-overlay/config.json` | Real config, not in git |
| `repo/overlay/deploy/docker-compose.yml` | The stack (project name `recipesage-overlay`) |

Shorthand used below:

```bash
cd /docker/recipesage-overlay
DC="docker compose -p recipesage-overlay -f repo/overlay/deploy/docker-compose.yml"
```

## Known state of the base stack (not managed here)

`/docker/recipesage/nginx/default.conf` is a hand-edited copy bind-mounted over the stock
`recipesage_proxy` config. It contains:

- `custom.css` injection via `sub_filter` on `/` (shopping-list zebra-striping fix, 2026-07-19)
- `/app/` → `static` rewrite (v4.0.7 service-worker precache fix, 2026-09-03)

Phase 2 (planned) moves both into the overlay proxy and restores the stock proxy config. Until
then, after any upgrade of the `recipesage-selfhost-proxy` image, diff its default config against
the mounted copy. A mounted copy means upstream proxy changes don't apply.

## First deploy

1. Clone the overlay onto the VPS:
   ```bash
   mkdir -p /docker/recipesage-overlay && cd /docker/recipesage-overlay
   git clone --filter=blob:none --sparse --branch main https://github.com/lehons/recipesage.git repo
   git -C repo sparse-checkout set overlay
   ```
2. Create the real config from the example and fill in the IDs:
   ```bash
   cp repo/overlay/config.example.json config.json
   nano config.json   # mealPlanId, shoppingListId, weeklyDefaultsLabel, quickAddEnabled
   chmod 644 config.json
   ```
3. Validate the nginx config before routing any traffic to it:
   ```bash
   docker run --rm -v "$PWD/repo/overlay/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable-alpine nginx -t
   ```
4. Start the stack. Traefik picks up the higher-priority router within seconds:
   ```bash
   $DC up -d
   ```
5. Verify (all must pass, otherwise roll back):
   ```bash
   H=https://recipesage.sherbot.cloud
   curl -s $H/ | grep -c 'overlay/inject/overlay.js'                          # 1
   curl -s -o /dev/null -w '%{http_code}\n' $H/overlay/config.json            # 200
   curl -s -o /dev/null -w '%{http_code}\n' $H/overlay/inject/overlay.js      # 200
   curl -s -o /dev/null -w '%{http_code}\n' $H/app/list/main                  # 200 (was 404)
   curl -s $H/app/list/main | grep -c 'overlay/inject/overlay.js'             # 1
   curl -s -o /dev/null -w '%{http_code}\n' $H/api/trpc/shoppingLists.getShoppingListItems   # 401
   curl -s -o /dev/null -w '%{http_code}\n' $H/overlay/quick-add/             # 200
   curl -s $H/overlay/quick-add/ | grep -c 'overlay/inject/overlay.js'        # 1 (bar injected)
   curl -s $H/ | grep -c 'custom.css'                                         # 1 (base stack injection still works)
   curl -s -o /dev/null -w '%{http_code}\n' $H/.well-known/oauth-authorization-server   # 200 (MCP stack, not overlay)
   curl -s -X POST $H/mcp | head -c 80; echo                                  # MCP's own JSON 401, not an nginx page
   docker logs --tail 20 recipesage_overlay
   ```
   In a browser (logged in): the bar shows on every page, and the Shopping badge matches the
   unchecked count. A hard refresh on a meal plan URL loads the page. Checking an item on the list
   updates the badge within about a second. Realtime sync still works: edit the list on a second
   device and watch it update.

## Update the overlay (new commits on `main`)

```bash
cd /docker/recipesage-overlay
git -C repo pull --ff-only
```

- `inject/*` changes are live immediately (bind mount). Browsers revalidate (`no-cache`).
- `nginx.conf` changed: `docker exec recipesage_overlay nginx -t && docker exec recipesage_overlay nginx -s reload`.
- `docker-compose.yml` changed: `$DC up -d`.
- `config.json` changed: live immediately if edited in place (`nano`, `cp` over it). If a tool
  replaces the file (new inode), the single-file mount keeps the old content: `$DC up -d --force-recreate`.
- `deploy/` is mounted as a directory so `nginx.conf` changes from `git pull` are visible to
  the container. Always run `nginx -t` inside the container before reloading.

## After an upstream RecipeSage upgrade

Run the verification block from step 5, then check the integration points listed in the repo `AGENTS.md`:

- Routes still `/app/meal-planners/<id>`, `/app/shopping-lists/<id>`, `/app/list/main?labels=`.
- `localStorage["token"]` still holds the session token (DevTools → Application).
- `shoppingLists.getShoppingListItems` still exists: the badge shows a number. If the badge
  disappears, fix `overlay/inject/api.js`, which is the only file that calls the API.
- Quick add still works: add an item at `/overlay/quick-add/`, confirm it shows on the list, then
  delete it (`shoppingLists.createShoppingListItems`, `shoppingLists.getShoppingList`).
- `<ion-app>` still the app shell: page content ends above the bar instead of behind it.
- `index.html` still has a `</head>` for `sub_filter` to hook.

If the upgrade breaks the overlay, roll the overlay back (below). The base app keeps working
without it.

## Roll back

- **Remove the overlay entirely** (traffic returns to `recipesage_proxy` via its own router):
  ```bash
  cd /docker/recipesage-overlay && $DC down
  ```
- **Revert to a previous overlay version:**
  ```bash
  git -C repo log --oneline -5
  git -C repo checkout <sha>          # detached; `git -C repo checkout main` to return
  docker exec recipesage_overlay nginx -s reload
  ```

## Service worker and HTML caching

The app's `service-worker.js` caches `/app/index.html` and fetches it network-first on each
navigation, using the browser's HTTP cache. Because the overlay rewrites the HTML, upstream
`ETag`/`Last-Modified` validators describe the un-injected file. A revalidation would get a 304
from upstream and keep the old copy without the overlay tags. That is what happened on first
deploy (2026-09-28). On the app HTML routes, `nginx.conf` therefore:

- strips `If-None-Match`/`If-Modified-Since` going upstream (the `$rso_is_html` map), and
- hides upstream `ETag`/`Last-Modified` (the HTML `location` blocks). The overlay nginx's own
  not-modified check compares the browser's validators against those headers before the
  rewrite, so passing them through also produces 304s.

The browser then has no validators to send, and always gets the full injected page.

- The first load after a change may still show the old HTML. The service worker refreshes its copy
  in the background, so the next load (or reopening the app) has it.
- If the app ever serves HTML from a new path, add it to the `$rso_is_html` map **and** give it a
  `location` with the two `proxy_hide_header` lines.
- Changes to `overlay.js` and `overlay.css` are not affected; they're fetched with `no-cache`.
- Side effect: the base stack's `custom.css` injection (on `/` only) had the same problem, so
  service-worker clients weren't getting it. Phase 2 moves that injection here.
