// Every RecipeSage API call the injected overlay makes lives here.
// tRPC is internal to upstream (not a public contract): if an upgrade breaks
// the badge, this is the one file to fix. Verified against upstream v4.0.13.

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

// Number of unchecked items on a shopping list, or null if unavailable.
// Counts raw items, not the grouped rows the upstream list page displays.
export async function getUncheckedItemCount(shoppingListId) {
  const items = await trpcQuery("shoppingLists.getShoppingListItems", {
    shoppingListId,
  });
  if (!Array.isArray(items)) return null;
  return items.filter((item) => !item.completed).length;
}
