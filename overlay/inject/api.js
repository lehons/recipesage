// Every RecipeSage API call the overlay makes lives here (bottom bar and
// quick-add page). tRPC is internal to upstream (not a public contract): if an
// upgrade breaks the badge or quick-add, this is the one file to fix.
// Verified against upstream source v4.0.13 and live v4.0.7.

const API_BASE = "/api/";

function getToken() {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return !!getToken();
}

// tRPC query over plain GET. The upstream transformer is identity on the
// request side, so input is plain JSON and the response is { result: { data } }.
async function trpcQuery(procedure, input) {
  const token = getToken();
  if (!token) return null;

  const url =
    API_BASE +
    "trpc/" +
    procedure +
    "?input=" +
    encodeURIComponent(JSON.stringify(input));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const body = await res.json();
  return body?.result?.data ?? null;
}

// tRPC mutation: POST with the plain JSON input as the body. Throws on
// failure so callers can keep what the user typed.
async function trpcMutation(procedure, input) {
  const token = getToken();
  if (!token) throw new Error("Not logged in");

  const res = await fetch(API_BASE + "trpc/" + procedure, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`${procedure} failed (${res.status})`);

  const body = await res.json();
  return body?.result?.data ?? null;
}

// Items on a shopping list ({ title, completed, ... }), or null if unavailable.
export async function getShoppingListItems(shoppingListId) {
  const items = await trpcQuery("shoppingLists.getShoppingListItems", {
    shoppingListId,
  });
  return Array.isArray(items) ? items : null;
}

// Shopping list title, or null if unavailable.
export async function getShoppingListTitle(id) {
  const list = await trpcQuery("shoppingLists.getShoppingList", { id });
  return list?.title ?? null;
}

// Number of unchecked items on a shopping list, or null if unavailable.
// Counts raw items, not the grouped rows the upstream list page displays.
export async function getUncheckedItemCount(shoppingListId) {
  const items = await getShoppingListItems(shoppingListId);
  if (!items) return null;
  return items.filter((item) => !item.completed).length;
}

// Adds items by title. The server assigns the aisle category and pushes the
// change to other open clients.
export const ITEM_TITLE_MAX_LENGTH = 254;

export async function addShoppingListItems(shoppingListId, titles) {
  await trpcMutation("shoppingLists.createShoppingListItems", {
    shoppingListId,
    items: titles.map((title) => ({ title, recipeId: null })),
  });
}
