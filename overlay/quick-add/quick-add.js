// Quick-add page (T2): type an item, Enter adds it to the configured
// shopping list. Suggestions come from the list's hand-added items (checked or
// not) plus this device's quick-add history (localStorage). All API calls go
// through the shared overlay API module.

import {
  ITEM_TITLE_MAX_LENGTH,
  addShoppingListItems,
  getShoppingListItems,
  getShoppingListTitle,
  isLoggedIn,
} from "/overlay/inject/api.js";

const CONFIG_URL = "/overlay/config.json";
const HISTORY_KEY = "rso-quick-add-history";
const MAX_SUGGESTIONS = 8;
const MAX_USUAL = 12;

const $ = (id) => document.getElementById(id);
const input = $("item-input");
const addButton = $("add-button");
const suggestionsEl = $("suggestions");

let config;
// key -> { title, unchecked } from the shopping list (hand-added items only)
let listItems = new Map();
// key -> { title, count, last } added from this device
let history = loadHistory();
let suggestions = [];
let highlighted = -1;

function keyOf(title) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanTitle(title) {
  return title.trim().replace(/\s+/g, " ").slice(0, ITEM_TITLE_MAX_LENGTH);
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveHistory() {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(Object.fromEntries(history)),
    );
  } catch {
    // Storage unavailable (private mode): history just won't persist.
  }
}

function recordHistory(title) {
  const key = keyOf(title);
  const entry = history.get(key) || { title, count: 0, last: 0 };
  entry.title = title;
  entry.count += 1;
  entry.last = Date.now();
  history.set(key, entry);
  saveHistory();
}

async function refreshList() {
  const items = await getShoppingListItems(config.shoppingListId);
  if (!items) return;
  const next = new Map();
  for (const item of items) {
    // Lines added from a recipe ("19 oz can of white beans (see note 1)")
    // make poor suggestions; only learn from items typed in by hand.
    if (item.recipeId) continue;
    const key = keyOf(item.title);
    const existing = next.get(key);
    next.set(key, {
      title: item.title,
      unchecked: (existing?.unchecked ?? false) || !item.completed,
    });
  }
  listItems = next;
  render();
}

// All known titles with their ranking signals.
function candidates() {
  const all = new Map();
  for (const [key, item] of listItems) {
    all.set(key, { key, title: item.title, count: 0, last: 0, unchecked: item.unchecked });
  }
  for (const [key, entry] of history) {
    const existing = all.get(key);
    all.set(key, {
      key,
      title: entry.title,
      count: entry.count,
      last: entry.last,
      unchecked: existing?.unchecked ?? false,
    });
  }
  return [...all.values()];
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
    if (idx === -1 || c.key === q) continue;
    // Prefer matches at the start of the title, then at a word start.
    const rank = idx === 0 ? 0 : c.key[idx - 1] === " " ? 1 : 2;
    scored.push({ ...c, rank: rank + (c.unchecked ? 3 : 0) });
  }
  scored.sort((a, b) => a.rank - b.rank || byUsage(a, b));
  return scored.slice(0, MAX_SUGGESTIONS);
}

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

function render() {
  const query = input.value;
  addButton.disabled = !cleanTitle(query);

  // Suggestions for the current text.
  suggestions = matchesFor(query);
  if (highlighted >= suggestions.length) highlighted = -1;
  suggestionsEl.replaceChildren(
    ...suggestions.map((s, i) => {
      const li = document.createElement("li");
      li.id = `suggestion-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === highlighted));
      const title = document.createElement("span");
      title.className = "title";
      title.append(highlightMatch(s.title, query));
      li.append(title);
      if (s.unchecked) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "on list";
        li.append(tag);
      }
      // pointerdown + preventDefault keeps focus (and the phone keyboard) in the input.
      li.addEventListener("pointerdown", (e) => e.preventDefault());
      li.addEventListener("click", () => add(s.title));
      return li;
    }),
  );
  suggestionsEl.hidden = suggestions.length === 0;
  if (highlighted >= 0) input.setAttribute("aria-activedescendant", `suggestion-${highlighted}`);
  else input.removeAttribute("aria-activedescendant");

  // Usual items: when the input is empty, items not already unchecked on the
  // list. Quick-add history ranks first, then checked-off list items.
  const usual = query.trim()
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
      b.addEventListener("pointerdown", (e) => e.preventDefault());
      b.addEventListener("click", () => add(c.title));
      return b;
    }),
  );
  $("usual").hidden = usual.length === 0;
}

function addedRow(title) {
  const li = document.createElement("li");
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = "…";
  const text = document.createElement("span");
  text.textContent = title;
  li.append(status, text);
  $("added-list").prepend(li);
  $("added").hidden = false;
  return li;
}

async function add(rawTitle, row) {
  const title = cleanTitle(rawTitle);
  if (!title) return;

  input.value = "";
  highlighted = -1;
  input.focus();

  row = row || addedRow(title);
  row.className = "";
  row.querySelector(".status").textContent = "…";
  row.querySelector("button")?.remove();

  // Optimistic: treat it as on the list right away.
  const key = keyOf(title);
  listItems.set(key, { title, unchecked: true });
  recordHistory(title);
  render();

  try {
    await addShoppingListItems(config.shoppingListId, [title]);
    row.className = "ok";
    row.querySelector(".status").textContent = "✓";
  } catch (e) {
    console.warn("[quick-add] add failed", e);
    row.className = "failed";
    row.querySelector(".status").textContent = "!";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => add(title, row));
    row.append(retry);
  }
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

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      highlighted = (highlighted + 1) % suggestions.length;
      render();
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      highlighted = highlighted <= 0 ? suggestions.length - 1 : highlighted - 1;
      render();
    } else if (e.key === "Escape") {
      highlighted = -1;
      input.value = "";
      render();
    }
  });

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
    if (title) $("list-title").textContent = `to ${title}`;
  });
  refreshList();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshList();
  });
}

init();
