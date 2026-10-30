/* Local site search: lazy index, AND prefix matching, combobox + listbox dialog. */
(function () {
  "use strict";

  var MAX_RESULTS = 12;
  var SNIPPET_LENGTH = 150;
  // Field weights: title > lesson number > heading > context > description > body.
  var WEIGHT = { title: 10, number: 8, heading: 6, context: 3, description: 3, body: 1 };
  var EXACT_BONUS = 1.5; // a whole-word match is worth more than a prefix match
  var TOKEN = /\d+\.[a-z]\b|[\p{L}\p{N}]+/gu;

  /* ---------- Pure functions (exported for tests at the bottom) ---------- */

  // Lowercase and strip diacritics while keeping string length, so indices
  // in the folded text map one-to-one onto the original (needed for snippets).
  function fold(text) {
    var out = "";
    for (var ch of String(text || "")) {
      var lower = ch.toLowerCase();
      var plain = lower.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      out += plain.length === ch.length ? plain : lower.length === ch.length ? lower : ch;
    }
    return out;
  }

  function tokenize(text) {
    return fold(text).match(TOKEN) || [];
  }

  // Unique query terms, longest first so highlighting prefers the longer match.
  function queryTerms(query) {
    var seen = Object.create(null);
    return tokenize(query).filter(function (t) {
      if (seen[t]) return false;
      seen[t] = true;
      return true;
    });
  }

  function prepare(index) {
    var pages = (index && index.pages) || [];
    return pages.map(function (p, i) {
      var headings = (p.h || []).map(function (h) {
        return { text: h.t, anchor: h.a, tokens: tokenize(h.t) };
      });
      return {
        order: i,
        title: p.t || "",
        url: p.u || "",
        kind: p.k || "",
        subject: p.s || "",
        module: p.m || "",
        number: p.n || "",
        description: p.d || "",
        body: p.b || "",
        headings: headings,
        tokens: {
          title: tokenize(p.t),
          context: tokenize((p.s || "") + " " + (p.m || "")),
          description: tokenize(p.d),
          body: tokenize(p.b)
        }
      };
    });
  }

  // 2 = whole-word match, 1 = prefix match, 0 = none.
  function matchTokens(tokens, term) {
    var best = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === term) return 2;
      if (best === 0 && tokens[i].indexOf(term) === 0) best = 1;
    }
    return best;
  }

  function matchNumber(number, term) {
    if (!number) return 0;
    if (number === term) return 2;
    return /^\d/.test(term) && number.indexOf(term) === 0 ? 1 : 0;
  }

  function fieldScore(weight, match) {
    return match === 2 ? weight * EXACT_BONUS : match === 1 ? weight : 0;
  }

  // Score one prepared page. Returns null unless every term matches somewhere.
  function scorePage(page, terms) {
    if (!terms.length) return null;
    var total = 0;
    var titleHits = 0;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var titleMatch = matchTokens(page.tokens.title, term);
      if (titleMatch) titleHits++;
      var best = Math.max(
        fieldScore(WEIGHT.title, titleMatch),
        fieldScore(WEIGHT.number, matchNumber(page.number, term)),
        fieldScore(WEIGHT.context, matchTokens(page.tokens.context, term)),
        fieldScore(WEIGHT.description, matchTokens(page.tokens.description, term)),
        fieldScore(WEIGHT.body, matchTokens(page.tokens.body, term))
      );
      for (var h = 0; h < page.headings.length; h++) {
        best = Math.max(best, fieldScore(WEIGHT.heading, matchTokens(page.headings[h].tokens, term)));
      }
      if (best === 0) return null;
      total += best;
    }
    if (titleHits === terms.length) total += WEIGHT.title; // the whole query is in the title

    // Deep-link to the heading that covers the most terms, but only when it
    // explains the match better than the title does.
    var heading = null;
    var headingHits = 0;
    for (var j = 0; j < page.headings.length; j++) {
      var hits = 0;
      for (var k = 0; k < terms.length; k++) if (matchTokens(page.headings[j].tokens, terms[k])) hits++;
      if (hits > headingHits) {
        headingHits = hits;
        heading = page.headings[j];
      }
    }
    if (headingHits <= titleHits) heading = null;
    return { score: total, heading: heading };
  }

  function search(pages, query, limit) {
    var terms = queryTerms(query);
    if (!terms.length) return [];
    var results = [];
    for (var i = 0; i < pages.length; i++) {
      var r = scorePage(pages[i], terms);
      if (r) results.push({ page: pages[i], score: r.score, heading: r.heading, terms: terms });
    }
    results.sort(function (a, b) {
      return b.score - a.score || a.page.order - b.page.order;
    });
    return results.slice(0, limit || MAX_RESULTS);
  }

  // Positions of word-start term matches in `text`: [[start, end], …].
  function findMatches(text, terms) {
    var folded = fold(text);
    var sorted = terms.slice().sort(function (a, b) { return b.length - a.length; });
    var ranges = [];
    var re = new RegExp(TOKEN.source, "gu");
    var m;
    while ((m = re.exec(folded))) {
      for (var i = 0; i < sorted.length; i++) {
        if (m[0].indexOf(sorted[i]) === 0) {
          ranges.push([m.index, m.index + sorted[i].length]);
          break;
        }
      }
    }
    return ranges;
  }

  // Split text into [{text, match}] segments for safe DOM highlighting.
  function highlight(text, terms) {
    text = String(text || "");
    var segments = [];
    var at = 0;
    findMatches(text, terms).forEach(function (r) {
      if (r[0] > at) segments.push({ text: text.slice(at, r[0]), match: false });
      segments.push({ text: text.slice(r[0], r[1]), match: true });
      at = r[1];
    });
    if (at < text.length) segments.push({ text: text.slice(at), match: false });
    return segments;
  }

  // A short window of `text` around the first match, trimmed to word edges.
  function snippet(text, terms, length) {
    text = String(text || "");
    length = length || SNIPPET_LENGTH;
    if (text.length <= length) return text;
    var first = findMatches(text, terms)[0];
    var start = first ? Math.max(0, first[0] - Math.floor(length / 3)) : 0;
    var end = Math.min(text.length, start + length);
    start = Math.max(0, end - length);
    if (start > 0) {
      var space = text.indexOf(" ", start);
      if (space !== -1 && space < (first ? first[0] : end)) start = space + 1;
    }
    if (end < text.length) {
      var lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start + length / 2) end = lastSpace;
    }
    return (start > 0 ? "… " : "") + text.slice(start, end).trim() + (end < text.length ? " …" : "");
  }

  // Prefer the passage under the matched heading, then a body passage that
  // contains a term, then the description.
  function resultSnippet(page, terms, heading) {
    var at = heading ? page.body.indexOf(heading.text) : -1;
    if (at !== -1) {
      var section = page.body.slice(at + heading.text.length, at + heading.text.length + 600).trim();
      if (section) return snippet(section, terms);
    }
    if (page.body && findMatches(page.body, terms).length) return snippet(page.body, terms);
    if (page.description) return snippet(page.description, terms);
    return snippet(page.body, terms);
  }

  var api = {
    fold: fold, tokenize: tokenize, queryTerms: queryTerms, prepare: prepare,
    scorePage: scorePage, search: search, findMatches: findMatches,
    highlight: highlight, snippet: snippet, resultSnippet: resultSnippet
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---------- Browser UI ---------- */

  var dialog = document.querySelector("[data-search-dialog]");
  var buttons = document.querySelectorAll("[data-search-open]");
  if (!dialog || typeof dialog.showModal !== "function") return; // leave buttons hidden

  var input = dialog.querySelector("[data-search-input]");
  var list = dialog.querySelector("[data-search-results]");
  var status = dialog.querySelector("[data-search-status]");
  var message = dialog.querySelector("[data-search-message]");
  var root = document.documentElement;
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  var isApple = /mac|iphone|ipad|ipod/i.test(platform);

  var pages = null;
  var loading = null;
  var results = [];
  var active = -1;
  var opener = null;

  buttons.forEach(function (button) {
    var kbd = button.querySelector("[data-search-kbd]");
    if (kbd) kbd.textContent = isApple ? "⌘K" : "Ctrl K";
    button.setAttribute("aria-keyshortcuts", isApple ? "Meta+K /" : "Control+K /");
    button.hidden = false;
    button.addEventListener("click", function () { open(button); });
  });

  function load() {
    if (pages) return Promise.resolve(pages);
    if (!loading) {
      setMessage("Loading the index…");
      loading = fetch(dialog.getAttribute("data-index"), { headers: { Accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          pages = prepare(data);
          return pages;
        })
        .catch(function (error) {
          loading = null; // allow a retry on the next open
          throw error;
        });
    }
    return loading;
  }

  function open(from) {
    if (dialog.open) {
      input.focus();
      input.select();
      return;
    }
    opener = from || document.activeElement;
    var scrollbar = window.innerWidth - root.clientWidth;
    if (scrollbar > 0) root.style.setProperty("--search-scrollbar", scrollbar + "px");
    root.classList.add("search-open");
    dialog.showModal();
    input.focus();
    input.select();
    load().then(update, function () {
      setMessage("The search index could not be loaded. Check your connection and try again.");
      announce("Search unavailable.");
    });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener("close", function () {
    root.classList.remove("search-open");
    root.style.removeProperty("--search-scrollbar");
    var target = opener;
    opener = null;
    if (target && typeof target.focus === "function" && document.contains(target)) target.focus({ preventScroll: true });
  });

  // A click on the backdrop lands on the <dialog> itself; its content fills the box.
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) close();
  });
  dialog.querySelector("[data-search-close]").addEventListener("click", close);

  function setMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function announce(text) {
    status.textContent = text;
  }

  function appendHighlighted(parent, text, terms) {
    highlight(text, terms).forEach(function (segment) {
      if (segment.match) {
        var mark = document.createElement("mark");
        mark.textContent = segment.text;
        parent.appendChild(mark);
      } else {
        parent.appendChild(document.createTextNode(segment.text));
      }
    });
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderResult(result, i) {
    var page = result.page;
    var terms = result.terms;
    var li = element("li", "search-result");
    li.id = "search-option-" + i;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");

    var link = element("a");
    link.href = page.url + (result.heading ? "#" + encodeURIComponent(result.heading.anchor) : "");
    link.tabIndex = -1;

    var meta = element("span", "search-meta");
    if (page.number) meta.appendChild(element("span", "search-number", page.number));
    var context = [page.subject, page.module].filter(Boolean).join(" / ");
    meta.appendChild(element("span", null, context || page.kind));
    link.appendChild(meta);

    var title = element("span", "search-title");
    appendHighlighted(title, page.title, terms);
    link.appendChild(title);

    if (result.heading) {
      var heading = element("span", "search-heading");
      heading.appendChild(element("span", "search-section-mark", "§ "));
      appendHighlighted(heading, result.heading.text, terms);
      link.appendChild(heading);
    }

    var text = resultSnippet(page, terms, result.heading);
    if (text) {
      var excerpt = element("span", "search-snippet");
      appendHighlighted(excerpt, text, terms);
      link.appendChild(excerpt);
    }

    li.appendChild(link);
    li.addEventListener("mousemove", function () { if (active !== i) setActive(i, false); });
    return li;
  }

  function update() {
    if (!pages) return;
    var query = input.value.trim();
    results = search(pages, query, MAX_RESULTS);
    list.replaceChildren.apply(list, results.map(renderResult));
    var expanded = results.length > 0;
    input.setAttribute("aria-expanded", String(expanded));
    list.hidden = !expanded;
    active = -1;
    input.removeAttribute("aria-activedescendant");

    if (!query) {
      setMessage("Search lessons, headings, and notes. Every word must match; partial words count. Try a lesson number such as 1.a.");
      announce("");
    } else if (!expanded) {
      setMessage("No results for “" + query + "”. Try fewer or shorter words, or check the spelling.");
      announce("No results.");
    } else {
      setMessage("");
      setActive(0, true);
      announce(results.length === 1 ? "1 result." : results.length + " results" + (results.length === MAX_RESULTS ? " shown." : "."));
    }
  }

  function setActive(i, scroll) {
    var options = list.children;
    if (active >= 0 && options[active]) options[active].setAttribute("aria-selected", "false");
    active = i;
    var option = options[i];
    if (!option) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    option.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }

  function openActive(event) {
    var option = list.children[active];
    var link = option && option.querySelector("a");
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(link.href, "_blank", "noopener");
      return;
    }
    close();
    window.location.assign(link.href);
  }

  input.addEventListener("input", update);

  input.addEventListener("keydown", function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    var count = results.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!count) return;
      event.preventDefault();
      var step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + count) % count, true);
    } else if (event.key === "Home" && event.ctrlKey && count) {
      event.preventDefault();
      setActive(0, true);
    } else if (event.key === "End" && event.ctrlKey && count) {
      event.preventDefault();
      setActive(count - 1, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openActive(event);
    }
  });

  // Same-page anchor links do not unload the page, so close the dialog first.
  list.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) close();
  });

  function isEditable(target) {
    if (!target || target === document.body) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !/^(button|checkbox|color|file|image|radio|range|reset|submit)$/i.test(target.type);
  }

  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.isComposing || event.altKey) return;
    var key = event.key;
    if ((key === "k" || key === "K") && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      // On Apple platforms Ctrl-K deletes to end of line in text fields; leave that alone.
      if (isApple && event.ctrlKey && !event.metaKey && isEditable(event.target)) return;
      event.preventDefault();
      if (dialog.open) close();
      else open();
    } else if (key === "/" && !event.metaKey && !event.ctrlKey && !dialog.open && !isEditable(event.target)) {
      event.preventDefault();
      open();
    }
  });
})();
