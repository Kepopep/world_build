// Shared [[wikilink]] regex source + a parsing helper, extracted out of
// editor.js so graph.js (which needs to extract wikilink targets from raw
// markdown too) doesn't duplicate the pattern. editor.js's tokenizer still
// owns all resolution/highlighting logic -- this module is intentionally
// just the regex + a plain "give me the raw titles" helper, nothing else.

(function () {
  const WIKILINK_SOURCE = "\\[\\[([^\\[\\]\\n]+)\\]\\]";

  // Returns the raw (trimmed) titles inside every [[Title]] occurrence in
  // `markdown`, in source order, duplicates included -- callers that need a
  // deduplicated set (e.g. graph edge computation) dedupe themselves.
  function extractWikilinks(markdown) {
    const re = new RegExp(WIKILINK_SOURCE, "g");
    const titles = [];
    let m;
    while ((m = re.exec(markdown || "")) !== null) {
      titles.push(m[1].trim());
    }
    return titles;
  }

  window.wikilinkParser = { WIKILINK_SOURCE, extractWikilinks };
})();
