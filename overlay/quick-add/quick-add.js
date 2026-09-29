// Quick-add page (T2): type an item, Return (or Add) puts it on the configured
// shopping list. Suggestions drop down under the input and come from the
// list's hand-added items (checked or not) plus this device's quick-add
// history (localStorage). The current list is shown below, read-only.
// All API calls go through the shared overlay API module.

import {
  ITEM_TITLE_MAX_LENGTH,
  addShoppingListItems,
  getShoppingListItems,
  getShoppingListTitle,
  isLoggedIn,
} from "/overlay/inject/api.js";

const CONFIG_URL = "/overlay/config.json";
const HISTORY_KEY = "rso-quick-add-history";
const DISMISSED_KEY = "rso-quick-add-dismissed";
const MAX_SUGGESTIONS = 8;
const MAX_USUAL = 8;
const LIST_REFRESH_MS = 30000;

const $ = (id) => document.getElementById(id);
const input = $("item-input");
const addButton = $("add-button");
const dropdown = $("suggestions");

let config;
// Raw items from the server.
let serverItems = [];
// key -> { title, unchecked } from hand-added list items (suggestion source)
let listItems = new Map();
// key -> { title, count, last } added from this device
let history = loadMap(HISTORY_KEY);
// keys the user removed from suggestions with the ✕
let dismissed = new Set(loadMap(DISMISSED_KEY).keys());
// Items added here that the server list doesn't show yet: { id, title, status }
let pending = [];
let pendingSeq = 0;
let suggestions = [];
let highlighted = -1;

// --- helpers -----------------------------------------------------------------

function keyOf(title) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanTitle(title) {
  return title.trim().replace(/\s+/g, " ").slice(0, ITEM_TITLE_MAX_LENGTH);
}

function loadMap(storageKey) {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey) || "{}")));
  } catch {
    return new Map();
  }
}

function saveMap(storageKey, map) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Storage unavailable (private mode): nothing persists, page still works.
  }
}

function saveDismissed() {
  saveMap(DISMISSED_KEY, new Map([...dismissed].map((k) => [k, 1])));
}

function recordHistory(title) {
  const key = keyOf(title);
  const entry = history.get(key) || { title, count: 0, last: 0 };
  entry.title = title;
  entry.count += 1;
  entry.last = Date.now();
  history.set(key, entry);
  saveMap(HISTORY_KEY, history);
  if (dismissed.delete(key)) saveDismissed();
}

function dismiss(key) {
  dismissed.add(key);
  saveDismissed();
  history.delete(key);
  saveMap(HISTORY_KEY, history);
}

// "::dairy" -> "Dairy"; custom categories are shown as-is.
function categoryLabel(categoryTitle) {
  if (!categoryTitle) return "Other";
  if (!categoryTitle.startsWith("::")) return categoryTitle;
  const name = categoryTitle.slice(2);
  if (name === "uncategorized") return "Other";
  if (name === "nonfood") return "Non-food";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// --- data --------------------------------------------------------------------

async function refreshList() {
  const items = await getShoppingListItems(config.shoppingListId);
  if (!items) return;
  serverItems = items;

  const next = new Map();
  for (const item of items) {
    // Lines added from a recipe ("19 oz can of white beans (see note 1)")
    // make poor suggestions; only learn from items typed in by hand.
    if (item.recipeId) continue;
    const key = keyOf(item.title);
    next.set(key, {
      title: item.title,
      unchecked: (next.get(key)?.unchecked ?? false) || !item.completed,
    });
  }
  listItems = next;

  // Drop pending rows the server now shows.
  const onServer = new Set(items.filter((i) => !i.completed).map((i) => keyOf(i.title)));
  pending = pending.filter((p) => p.status !== "saved" || !onServer.has(keyOf(p.title)));

  render();
}

function isUnchecked(key) {
  return (
    listItems.get(key)?.unchecked ||
    pending.some((p) => keyOf(p.title) === key) ||
    serverItems.some((i) => !i.completed && keyOf(i.title) === key)
  );
}

// All suggestible titles with their ranking signals.
function candidates() {
  const all = new Map();
  for (const [key, item] of listItems) {
    all.set(key, { key, title: item.title, count: 0, last: 0 });
  }
  for (const [key, entry] of history) {
    all.set(key, { key, title: entry.title, count: entry.count, last: entry.last });
  }
  return [...all.values()]
    .filter((c) => !dismissed.has(c.key))
    .map((c) => ({ ...c, unchecked: isUnchecked(c.key) }));
}

function byUsage(a, b) {
  return b.count - a.count || b.last - a.last || a.title.localeCompare(b.title);
}

function matchesFor(query) {
  const q = keyOf(query);
  if (!q) return [];
  const scored = [];
  for (const c of candidates()) {
    const idx = c.key.indexOf(q);
    if (idx === -1) continue;
    // Prefer matches at the start of the title, then at a word start.
    const rank = idx === 0 ? 0 : c.key[idx - 1] === " " ? 1 : 2;
    scored.push({ ...c, rank: rank + (c.unchecked ? 3 : 0) });
  }
  scored.sort((a, b) => a.rank - b.rank || byUsage(a, b));
  return scored.slice(0, MAX_SUGGESTIONS);
}

// --- rendering ---------------------------------------------------------------

function highlightMatch(title, query) {
  const frag = document.createDocumentFragment();
  const q = keyOf(query);
  const idx = title.toLowerCase().indexOf(q);
  if (!q || idx === -1) {
    frag.append(title);
    return frag;
  }
  const mark = document.createElement("mark");
  mark.textContent = title.slice(idx, idx + q.length);
  frag.append(title.slice(0, idx), mark, title.slice(idx + q.length));
  return frag;
}

// pointerdown + preventDefault keeps focus (and the phone keyboard) in the input.
function keepFocus(el) {
  el.addEventListener("pointerdown", (e) => e.preventDefault());
}

function renderDropdown() {
  const query = input.value;
  suggestions = document.activeElement === input ? matchesFor(query) : [];
  if (highlighted >= suggestions.length) highlighted = -1;

  dropdown.replaceChildren(
    ...suggestions.map((s, i) => {
      const li = document.createElement("li");
      li.id = `suggestion-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === highlighted));
      keepFocus(li);

      const title = document.createElement("span");
      title.className = "title";
      title.append(highlightMatch(s.title, query));
      li.append(title);
      li.addEventListener("click", () => add(s.title));

      if (s.unchecked) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "on list";
        li.append(tag);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dismiss";
      remove.setAttribute("aria-label", `Remove suggestion ${s.title}`);
      remove.textContent = "✕";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        dismiss(s.key);
        render();
      });
      li.append(remove);
      return li;
    }),
  );
  dropdown.hidden = suggestions.length === 0;
  input.setAttribute("aria-expanded", String(!dropdown.hidden));
  if (highlighted >= 0) input.setAttribute("aria-activedescendant", `suggestion-${highlighted}`);
  else input.removeAttribute("aria-activedescendant");
}

function renderUsual() {
  // When the input is empty: items not already on the list. Quick-add history
  // ranks first, then checked-off hand-added list items.
  const usual = input.value.trim()
    ? []
    : candidates()
        .filter((c) => !c.unchecked)
        .sort(byUsage)
        .slice(0, MAX_USUAL);
  $("usual-chips").replaceChildren(
    ...usual.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.title;
      keepFocus(b);
      b.addEventListener("click", () => add(c.title));
      return b;
    }),
  );
  $("usual").hidden = usual.length === 0;
}

function pendingRow(p) {
  const li = document.createElement("li");
  li.className = `pending ${p.status}`;
  const text = document.createElement("span");
  text.className = "title";
  text.textContent = p.title;
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = p.status === "failed" ? "Not saved" : p.status === "saved" ? "✓" : "…";
  li.append(text, status);
  if (p.status === "failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => save(p));
    li.append(retry);
  }
  return li;
}

function renderList() {
  const unchecked = serverItems.filter((i) => !i.completed);
  const groups = new Map();
  for (const item of unchecked) {
    const label = categoryLabel(item.categoryTitle);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  const labels = [...groups.keys()].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
  );

  const nodes = [];
  if (pending.length) {
    const ul = document.createElement("ul");
    ul.append(...pending.map(pendingRow));
    nodes.push(ul);
  }
  for (const label of labels) {
    const h3 = document.createElement("h3");
    h3.textContent = label;
    const ul = document.createElement("ul");
    for (const item of groups.get(label).sort((a, b) => a.title.localeCompare(b.title))) {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.className = "title";
      text.textContent = item.title;
      li.append(text);
      if (item.recipe?.title) {
        const from = document.createElement("span");
        from.className = "from";
        from.textContent = item.recipe.title;
        li.append(from);
      }
      ul.append(li);
    }
    nodes.push(h3, ul);
  }
  $("list-items").replaceChildren(...nodes);

  const count = unchecked.length;
  $("list-count").textContent = count ? String(count) : "";
  $("list-empty").hidden = count > 0 || pending.length > 0;
  $("list-link").href = "/app/shopping-lists/" + config.shoppingListId;
}

function render() {
  addButton.disabled = !cleanTitle(input.value);
  renderDropdown();
  renderUsual();
  renderList();
}

// --- actions -----------------------------------------------------------------

async function save(p) {
  p.status = "saving";
  renderList();
  try {
    await addShoppingListItems(config.shoppingListId, [p.title]);
    p.status = "saved";
    renderList();
    refreshList();
  } catch (e) {
    console.warn("[quick-add] add failed", e);
    p.status = "failed";
    renderList();
  }
}

function add(rawTitle) {
  const title = cleanTitle(rawTitle);
  if (!title) return;

  input.value = "";
  highlighted = -1;
  input.focus();

  recordHistory(title);
  const p = { id: ++pendingSeq, title, status: "saving" };
  pending.unshift(p);
  render();
  save(p);
}

function showMessage(html) {
  const el = $("message");
  el.innerHTML = html;
  el.hidden = false;
}

function wireInput() {
  input.addEventListener("input", () => {
    highlighted = -1;
    render();
  });
  input.addEventListener("focus", render);
  input.addEventListener("blur", render);

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      highlighted = (highlighted + 1) % suggestions.length;
      renderDropdown();
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      highlighted = highlighted <= 0 ? suggestions.length - 1 : highlighted - 1;
      renderDropdown();
    } else if (e.key === "Escape") {
      highlighted = -1;
      input.value = "";
      render();
    }
  });

  // Return on the keyboard and the Add button both submit. Return adds exactly
  // what was typed, unless a suggestion was picked with the arrow keys.
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    add(highlighted >= 0 ? suggestions[highlighted].title : input.value);
  });
}

async function init() {
  if (!isLoggedIn()) {
    input.disabled = true;
    addButton.disabled = true;
    showMessage('Not logged in. <a href="/app/">Open RecipeSage</a> and log in first.');
    return;
  }

  try {
    const res = await fetch(CONFIG_URL, { cache: "no-cache" });
    config = await res.json();
  } catch (e) {
    input.disabled = true;
    showMessage("Overlay config not found.");
    return;
  }

  wireInput();
  render();

  getShoppingListTitle(config.shoppingListId).then((title) => {
    if (title) {
      $("list-title").textContent = `to ${title}`;
      $("list-heading").textContent = title;
    }
  });
  refreshList();
  setInterval(() => {
    if (document.visibilityState === "visible") refreshList();
  }, LIST_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshList();
  });
}

init();
