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

// Flat folders + flat entries for the sidebar tree, fetched together since
// they're always needed together on a world switch. Response shape:
// { folders: [{id, worldId, parentFolderId, name, sortOrder}, ...],
//   entries: [EntryResponse, ...] }
function getHierarchy(worldId) {
  return request(`/worlds/${worldId}/hierarchy`);
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

// Moves an entry to a different folder (or, with folderId null, to the
// world's root) -- a dedicated endpoint rather than updateEntry(), since
// updateEntry()'s folderId follows the same "null means unchanged"
// convention as its other fields and so can't express "move to root". Used
// by the sidebar's drag-and-drop.
function moveEntry(id, folderId) {
  return request(`/entries/${id}/move`, {
    method: "PATCH",
    body: JSON.stringify({ folderId }),
  });
}

// Folders

// {name, parentFolderId?} -- omitting parentFolderId creates a top-level
// folder; passing it nests the new folder inside that parent.
function createFolder(worldId, data) {
  return request(`/worlds/${worldId}/folders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Rejected (409) by the server if the folder still has subfolders or
// entries in it -- see FolderService.deleteFolder.
function deleteFolder(id) {
  return request(`/folders/${id}`, {
    method: "DELETE",
  });
}

// Reparents a folder (parentFolderId null moves it to the world's root).
// Rejected (400) if it would create a cycle -- see FolderService.moveFolder.
// Used by the sidebar's drag-and-drop.
function moveFolder(id, parentFolderId) {
  return request(`/folders/${id}/move`, {
    method: "PATCH",
    body: JSON.stringify({ parentFolderId }),
  });
}

// Tags

// All tags defined in a world, for suggesting existing names when adding a
// tag to an entry (encourages reuse over creating near-duplicates).
function listWorldTags(worldId) {
  return request(`/worlds/${worldId}/tags`);
}

// Attaches a tag to an entry, creating it in the entry's world first if no
// tag with that name exists yet (the "dynamic" part of tag creation) --
// `data` is `{ name, color? }`; omitting color lets the server assign one
// from its default palette. Returns the updated EntryResponse (with its new
// tag list), not the tag itself, so callers can just replace their copy of
// the entry.
function addEntryTag(entryId, data) {
  return request(`/entries/${entryId}/tags`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Detaches a tag from an entry (does not delete the tag itself -- other
// entries may still carry it). Returns the updated EntryResponse.
function removeEntryTag(entryId, tagId) {
  return request(`/entries/${entryId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

// Updates a tag's own name/color -- affects every entry that carries it,
// not just the one being viewed. `data` is `{ name?, color? }`.
function updateTag(tagId, data) {
  return request(`/tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
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
  moveEntry,
  searchEntryTitles,
  getHierarchy,
  createFolder,
  deleteFolder,
  moveFolder,
  listWorldTags,
  addEntryTag,
  removeEntryTag,
  updateTag,
};
