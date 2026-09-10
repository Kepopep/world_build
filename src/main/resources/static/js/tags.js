// Tag pill row rendered under the entry title. Renders always (in both view
// and edit mode -- tags are content, not an editing affordance), but the
// add/remove/color-change controls only render when editable is true, same
// gating rule the rest of the entry editor follows: nothing is interactive
// outside edit mode.
//
// This module only ever talks back to app.js through the callbacks passed
// to render() -- it doesn't reach into app.js's `state` directly, same
// pattern editor.js follows.

(function () {
  // Small IDs so multiple <datalist> elements across renders never collide.
  let datalistCounter = 0;

  // config: { editable, worldId, onEntryChanged(updatedEntry), onError(message) }
  function render(container, entry, config) {
    container.innerHTML = "";
    if (!entry) {
      return;
    }

    const tags = entry.tags || [];
    for (const tag of tags) {
      container.appendChild(renderPill(tag, entry, config, container));
    }

    if (config.editable) {
      container.appendChild(renderAddControl(entry, config, container));
    }
  }

  function renderPill(tag, entry, config, container) {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.style.setProperty("--tag-color", tag.color);
    pill.style.color = contrastTextColor(tag.color);

    if (config.editable) {
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "tag-color-input";
      colorInput.value = normalizeHex(tag.color);
      colorInput.setAttribute("aria-hidden", "true");
      colorInput.tabIndex = -1;

      const colorDot = document.createElement("button");
      colorDot.type = "button";
      colorDot.className = "tag-color-dot";
      colorDot.title = "Change tag color";
      colorDot.setAttribute("aria-label", `Change color for ${tag.name}`);
      colorDot.addEventListener("click", (e) => {
        e.stopPropagation();
        colorInput.click();
      });

      colorInput.addEventListener("input", async () => {
        const newColor = colorInput.value;
        try {
          await window.api.updateTag(tag.id, { color: newColor });
          // The tag object is shared by reference with app.js's state.entries
          // (render() is always called with that same entry), so mutating it
          // here keeps state and the DOM in sync without a round trip back
          // through app.js. Other entries already loaded that also carry
          // this tag won't pick up the new color until they're reopened --
          // accepted scope boundary, not worth a full entries refetch for.
          tag.color = newColor;
          render(container, entry, config);
        } catch (err) {
          config.onError && config.onError(err.message);
        }
      });

      pill.appendChild(colorDot);
      pill.appendChild(colorInput);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "tag-name";
    nameSpan.textContent = tag.name;
    pill.appendChild(nameSpan);

    if (config.editable) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tag-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove tag";
      removeBtn.setAttribute("aria-label", `Remove tag ${tag.name}`);
      removeBtn.addEventListener("click", async () => {
        try {
          const updated = await window.api.removeEntryTag(entry.id, tag.id);
          config.onEntryChanged(updated);
        } catch (err) {
          config.onError && config.onError(err.message);
        }
      });
      pill.appendChild(removeBtn);
    }

    return pill;
  }

  function renderAddControl(entry, config, container) {
    const wrap = document.createElement("span");
    wrap.className = "tag-add-wrap";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "tag-add-btn";
    addBtn.textContent = "+ Add tag";

    const form = document.createElement("form");
    form.className = "tag-add-form";
    form.hidden = true;

    const datalistId = `tag-suggestions-${++datalistCounter}`;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tag-add-input";
    input.placeholder = "Tag name";
    input.maxLength = 40;
    input.setAttribute("list", datalistId);

    const datalist = document.createElement("datalist");
    datalist.id = datalistId;

    form.appendChild(input);
    form.appendChild(datalist);

    function closeForm() {
      form.hidden = true;
      addBtn.hidden = false;
      input.value = "";
    }

    addBtn.addEventListener("click", () => {
      addBtn.hidden = true;
      form.hidden = false;
      input.focus();
      // Suggest existing world tags so typing a name that already exists
      // reuses it (dynamic creation still happens server-side either way --
      // this is just a hint to encourage reuse over near-duplicate tags).
      window.api
        .listWorldTags(config.worldId)
        .then((worldTags) => {
          datalist.innerHTML = "";
          for (const t of worldTags) {
            const opt = document.createElement("option");
            opt.value = t.name;
            datalist.appendChild(opt);
          }
        })
        .catch(() => {
          // Suggestions are a nice-to-have; a failed fetch here shouldn't
          // block typing a tag name.
        });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) {
        return;
      }
      try {
        const updated = await window.api.addEntryTag(entry.id, { name });
        closeForm();
        config.onEntryChanged(updated);
      } catch (err) {
        config.onError && config.onError(err.message);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeForm();
      }
    });

    input.addEventListener("blur", () => {
      // Deferred so a click on the submit-via-Enter or a datalist option
      // isn't cut off by the blur firing first.
      setTimeout(() => {
        if (document.activeElement !== input) {
          closeForm();
        }
      }, 150);
    });

    wrap.appendChild(addBtn);
    wrap.appendChild(form);
    return wrap;
  }

  // ---- Color helpers -----------------------------------------------------

  function hexToRgb(hex) {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) {
      h = h.split("").map((c) => c + c).join("");
    }
    const num = parseInt(h, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  // <input type="color"> requires a strict #rrggbb value.
  function normalizeHex(hex) {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return hex;
    }
    const { r, g, b } = hexToRgb(hex);
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  // Picks black or white pill text for legibility against an arbitrary tag
  // color, via perceived luminance (ITU-R BT.601).
  function contrastTextColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
  }

  window.tags = { render };
})();
