// Bottom nav bar injected into every /app/ page (T1).
// Upstream coupling is limited to: the <ion-app> element (shortened so content
// isn't hidden behind the bar), Ionic CSS variables for colours, and Angular's
// router reacting to popstate. No upstream components or private DOM.

import {
  SHOPPING_LIST_CHANGED_EVENT,
  getUncheckedItemCount,
  isLoggedIn,
} from "./api.js";

const CONFIG_URL = "/overlay/config.json";
const BAR_ID = "rso-bottom-bar";
const ROUTE_POLL_MS = 500;

const ICONS = {
  recipes:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 11.5h5"/>',
  weekly:
    '<path d="M6 3h12v18l-6-4-6 4z"/><path d="M12 7.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>',
  planner:
    '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2M15 17h2"/>',
  shopping:
    '<path d="M3.5 6l1.5 1.5L8 4.5M3.5 12l1.5 1.5L8 10.5M3.5 18l1.5 1.5L8 16.5"/><path d="M11 6h10M11 12h10M11 18h10"/>',
  quickAdd:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
};

function buildTabs(config) {
  const label = config.weeklyDefaultsLabel;
  const tabs = [
    {
      key: "recipes",
      label: "Recipes",
      href: "/app/list/main",
      isActive: (url) =>
        url.pathname.startsWith("/app/list") &&
        url.searchParams.get("labels") !== label,
    },
    {
      key: "weekly",
      label: "Weekly",
      href: "/app/list/main?labels=" + encodeURIComponent(label),
      isActive: (url) =>
        url.pathname.startsWith("/app/list") &&
        url.searchParams.get("labels") === label,
    },
    {
      key: "planner",
      label: "Planner",
      href: "/app/meal-planners/" + config.mealPlanId,
      isActive: (url) => url.pathname.startsWith("/app/meal-planners/"),
    },
    {
      key: "shopping",
      label: "Shopping",
      href: "/app/shopping-lists/" + config.shoppingListId,
      isActive: (url) => url.pathname.startsWith("/app/shopping-lists/"),
      badge: true,
    },
  ];
  if (config.quickAddEnabled) {
    tabs.push({
      key: "quickAdd",
      label: "Quick add",
      href: "/overlay/quick-add/",
      isActive: (url) => url.pathname.startsWith("/overlay/quick-add"),
    });
  }
  return tabs;
}

// Navigate inside the Angular app without a full reload: push the URL, then
// fire popstate so the router picks it up. Links to or from pages outside
// /app/ (e.g. the quick-add page) load normally.
// Same page with a different query (Recipes <-> Weekly) also loads normally:
// upstream pages read query params only on ionViewWillEnter, which doesn't
// fire when the page is reused. Needs the proxy's deep-link fallback.
function navigate(href) {
  if (location.pathname + location.search === href) return;
  const target = new URL(href, location.origin);
  const inApp = location.pathname.startsWith("/app/");
  if (
    !inApp ||
    !href.startsWith("/app/") ||
    target.pathname === location.pathname
  ) {
    window.location.assign(href);
    return;
  }
  history.pushState(history.state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

function render(tabs) {
  const nav = document.createElement("nav");
  nav.id = BAR_ID;
  nav.setAttribute("aria-label", "Quick navigation");

  for (const tab of tabs) {
    const a = document.createElement("a");
    a.href = tab.href;
    a.dataset.key = tab.key;
    a.innerHTML =
      '<span class="rso-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      ICONS[tab.key] +
      "</svg>" +
      (tab.badge ? '<span class="rso-badge" hidden></span>' : "") +
      '</span><span class="rso-label"></span>';
    a.querySelector(".rso-label").textContent = tab.label;
    a.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
        return;
      event.preventDefault();
      navigate(tab.href);
    });
    nav.appendChild(a);
  }

  document.body.appendChild(nav);
  document.documentElement.classList.add("rso-bar-on");
  return nav;
}

function updateActive(nav, tabs) {
  const url = new URL(location.href);
  for (const tab of tabs) {
    const el = nav.querySelector(`[data-key="${tab.key}"]`);
    const active = tab.isActive(url);
    el.classList.toggle("rso-active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }
}

function setBadge(nav, count) {
  const badge = nav.querySelector(".rso-badge");
  if (!badge) return;
  if (!count) {
    badge.hidden = true;
    return;
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = false;
}

function startBadge(nav, config) {
  let inFlight = false;
  let debounce;

  const refresh = async () => {
    if (inFlight || document.visibilityState !== "visible") return;
    inFlight = true;
    try {
      setBadge(nav, await getUncheckedItemCount(config.shoppingListId));
    } catch {
      setBadge(nav, null);
    } finally {
      inFlight = false;
    }
  };

  const refreshSoon = () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 800);
  };

  refresh();
  setInterval(refresh, (config.badgeRefreshSeconds || 30) * 1000);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener(SHOPPING_LIST_CHANGED_EVENT, refreshSoon);
  // Checking items off on the list page changes the count; catch it quickly.
  document.addEventListener("click", () => {
    if (location.pathname.startsWith("/app/shopping-lists/")) refreshSoon();
  });
  return refreshSoon;
}

async function init() {
  if (window.top !== window || document.getElementById(BAR_ID)) return;

  let config;
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-cache" });
    config = await res.json();
  } catch (e) {
    console.warn("[overlay] config not loaded; bottom bar disabled", e);
    return;
  }

  const tabs = buildTabs(config);
  const nav = render(tabs);
  const refreshBadge = startBadge(nav, config);

  let lastHref = "";
  setInterval(() => {
    const loggedIn = isLoggedIn();
    nav.hidden = !loggedIn;
    document.documentElement.classList.toggle("rso-bar-on", loggedIn);
    if (location.href === lastHref) return;
    lastHref = location.href;
    updateActive(nav, tabs);
    refreshBadge();
  }, ROUTE_POLL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
