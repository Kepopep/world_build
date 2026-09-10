// Minimal fetch wrapper for the Mythos REST API.
// Every function either resolves with the parsed JSON response body,
// or throws an Error whose message comes from the server's
// {"message": "..."} error payload (falling back to statusText).

const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    let message = response.statusText || `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body && body.message) {
        message = body.message;
      }
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// Worlds

function listWorlds() {
  return request("/worlds");
}

function createWorld(data) {
  return request("/worlds", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

function getWorld(id) {
  return request(`/worlds/${id}`);
}

// Entries

function listEntries(worldId) {
  return request(`/worlds/${worldId}/entries`);
}

function createEntry(worldId, data) {
  return request(`/worlds/${worldId}/entries`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

function getEntry(id) {
  return request(`/entries/${id}`);
}

// Entry-title typeahead for the [[wikilink]] autocomplete popup. `signal`
// (optional) lets callers abort an in-flight search when a newer keystroke
// supersedes it.
function searchEntryTitles(worldId, q, limit, signal) {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  if (limit) {
    params.set("limit", limit);
  }
  const query = params.toString();
  return request(`/worlds/${worldId}/entries/search${query ? `?${query}` : ""}`, signal ? { signal } : {});
}

function updateEntry(id, data) {
  return request(`/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

function deleteEntry(id) {
  return request(`/entries/${id}`, {
    method: "DELETE",
  });
}

window.api = {
  listWorlds,
  createWorld,
  getWorld,
  listEntries,
  createEntry,
  getEntry,
  updateEntry,
  deleteEntry,
  searchEntryTitles,
};
