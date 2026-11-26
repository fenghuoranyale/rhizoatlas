(() => {
  "use strict";
  let dataRoot = "data/";
  let atlasState = {
    meta: null,
    idx: null,
    byId: {},
    lookup: {},
    alias: {},
    crops: {},
    layers: null,
    runs: null,
    clf: null,
    screen: null,
    chunk: {},
    og: null,
    filter: "all",
    mode: "chart",
    ready: false,
  };
  function setHash(h) {
    try {
      history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
    } catch (e) {}
  }
  let elementById = (id) => {
    return document.getElementById(id);
  };
  let escapeMarkup = (s) => {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  let fetchDataset = (u) => {
    return fetch(dataRoot + u).then((r) => {
      if (!r.ok) throw new Error(u + " " + r.status);
      return r.json();
    });
  };
  let formatPValue = (p) => {
    if (p == null) return "–";
    if (p < 1e-3) {
      let e = Math.floor(Math.log10(p));
      return (p / Math.pow(10, e)).toFixed(1) + "×10" + superscript(e);
    }
    return String(Number(p.toPrecision(2)));
  };
  function superscript(n) {
    let m = {
      "-": "⁻",
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
    };
    return String(n)
      .split("")
      .map((c) => {
        return m[c] || c;
      })
      .join("");
  }
  let colorScales = {};
  function parseColor(h) {
    h = h.trim().replace("#", "");
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => {
          return c + c;
        })
        .join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function readColorScales() {
    let cs = getComputedStyle(document.documentElement);
    colorScales.seq = ["--s0", "--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map((k) => {
      return parseColor(cs.getPropertyValue(k));
    });
    colorScales.div = ["--dn2", "--dn1", "--dmid", "--dp1", "--dp2"].map((k) => {
      return parseColor(cs.getPropertyValue(k));
    });
  }
  function interpolateColors(stops, t) {
    t = Math.max(0, Math.min(1, t));
    let x = t * (stops.length - 1),
      i = Math.min(stops.length - 2, Math.floor(x)),
      f = x - i,
      a = stops[i],
      b = stops[i + 1];
    return (
      "rgb(" +
      [0, 1, 2]
        .map((k) => {
          return Math.round(a[k] + (b[k] - a[k]) * f);
        })
        .join(",") +
      ")"
    );
  }
  let expressionColorMax = 10,
    contrastColorMax = 3;
  let expressionFill = (v) => {
    return interpolateColors(colorScales.seq, v / expressionColorMax);
  };
  let contrastFill = (v, m) => {
    return interpolateColors(colorScales.div, (v / (m || contrastColorMax) + 1) / 2);
  };
  function gradientBackground(stops) {
    return (
      "linear-gradient(90deg," +
      stops
        .map((c, i) => {
          return "rgb(" + c.join(",") + ") " + Math.round((100 * i) / (stops.length - 1)) + "%";
        })
        .join(",") +
      ")"
    );
  }
  let VIEWS = ["home", "gene", "analyze", "score", "find", "organ", "samples", "about"];
  let ORGAN_CLASSES = [
    ["rhizome", "Rhizome", "--o-rhizome"],
    ["aerial stem", "Aerial stem", "--o-stem"],
    ["root", "Root", "--o-root"],
    ["leaf", "Leaf", "--o-leaf"],
  ];
  function probabilityBar(p, title) {
    return (
      '<span class="pbar" title="' +
      escapeMarkup(title || "") +
      '">' +
      p
        .map((v, k) => {
          return v > 0.005
            ? '<span style="width:' + (100 * v).toFixed(1) + "%;background:var(" + ORGAN_CLASSES[k][2] + ')"></span>'
            : "";
        })
        .join("") +
      "</span>"
    );
  }
  function organLegend() {
    return ORGAN_CLASSES.map((c) => {
      return '<span><span class="sw" style="background:var(' + c[2] + ')"></span>' + c[1] + "</span>";
    }).join("");
  }
  function showView(v) {
    if (VIEWS.indexOf(v) < 0) v = "home";
    document.body.dataset.view = v;
    VIEWS.forEach((k) => {
      elementById("view-" + k).hidden = k !== v;
    });
    document.querySelectorAll("nav.links a").forEach((a) => {
      if (a.dataset.view === v || a.dataset.also === v) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    hideSuggest();
    if (v !== "gene") elementById("q").value = "";
    if (v === "score") renderScoreView();
    if (v === "find") renderFindView();
    if (v === "organ") renderOrganView();
    if (v === "analyze") renderAnalyzeView();
    if (v === "samples") renderSampleRows(true);
    if (v === "about") renderAboutSection();
    if (v === "home" && finePointer) elementById("hq").focus();
    if (atlasState.ready) setHash(v === "home" ? "" : v === "gene" && atlasState.og != null ? "gene/" + atlasState.idx[atlasState.og][0] : v);
    window.scrollTo(0, 0);
  }
  let finePointer = window.matchMedia ? window.matchMedia("(pointer: fine)").matches : true;
  function hideSuggest() {
    document.querySelectorAll(".suggest").forEach((b) => {
      b.hidden = true;
    });
  }
  function doSearch(q) {
    q = String(q || "").trim();
    if (!q) return;
    hideSuggest();
    showView("gene");
    searchAndDisplay(q);
  }
  elementById("hsearch").addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch(elementById("q").value);
  });
  elementById("home-search").addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch(elementById("hq").value);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "")) return;
    e.preventDefault();
    elementById(document.body.dataset.view === "home" ? "hq" : "q").focus();
  });
  let suggestList = null;
  function buildSuggestIndex(aliases) {
    let a = [];
    atlasState.idx.forEach((r, i) => {
      let d0 = (r[1][0] || [])[2] || "";
      r[1].forEach((m) => {
        let d = m[2] || d0;
        if (m[1]) a.push([m[1].toUpperCase(), i, m[1], m[0] + (d ? " · " + d : "")]);
        a.push([m[0].toUpperCase(), i, m[0], (m[1] ? m[1] + " · " : "") + d]);
      });
    });
    Object.keys(aliases || {}).forEach((k) => {
      (aliases[k] || []).forEach((og) => {
        let i = atlasState.byId[og];
        if (i == null) return;
        let r = atlasState.idx[i];
        a.push([k.toUpperCase(), i, k, orthogroupLabel(og) + " · " + ((r[1][0] || [])[2] || og)]);
      });
    });
    a.sort((x, y) => {
      return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
    });
    suggestList = a;
  }
  function suggestionsFor(q) {
    q = normalizeUppercase(q);
    if (q.length < 2 || !suggestList) return [];
    let lo = 0,
      hi = suggestList.length;
    while (lo < hi) {
      let mid = (lo + hi) >> 1;
      if (suggestList[mid][0] < q) lo = mid + 1;
      else hi = mid;
    }
    let out = [],
      seen = {};
    for (let k = lo; k < suggestList.length && out.length < 8; k++) {
      let e = suggestList[k];
      if (e[0].indexOf(q) !== 0) break;
      if (seen[e[1]]) continue;
      seen[e[1]] = 1;
      out.push(e);
    }
    return out;
  }
  function attachSuggest(inputId, boxId) {
    let inp = elementById(inputId),
      box = elementById(boxId),
      items = [],
      act = -1;
    function render() {
      items = suggestionsFor(inp.value);
      act = -1;
      if (!items.length) {
        box.hidden = true;
        return;
      }
      box.innerHTML = items
        .map((e, k) => {
          return '<button type="button" role="option" data-k="' + k + '"><b>' + escapeMarkup(e[2]) + "</b><span>" + escapeMarkup(e[3]) + "</span></button>";
        })
        .join("");
      box.hidden = false;
      box.querySelectorAll("button").forEach((b) => {
        b.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          pick(+b.dataset.k);
        });
      });
    }
    function pick(k) {
      let e = items[k];
      box.hidden = true;
      showView("gene");
      selectOrthogroup(e[1], e[2]);
      inp.blur();
    }
    function mark() {
      box.querySelectorAll("button").forEach((b, k) => {
        b.setAttribute("aria-selected", k === act ? "true" : "false");
      });
    }
    inp.addEventListener("input", render);
    inp.addEventListener("keydown", (ev) => {
      if (box.hidden) return;
      if (ev.key === "ArrowDown") {
        act = Math.min(items.length - 1, act + 1);
        mark();
        ev.preventDefault();
      } else if (ev.key === "ArrowUp") {
        act = Math.max(-1, act - 1);
        mark();
        ev.preventDefault();
      } else if (ev.key === "Enter" && act >= 0) {
        ev.preventDefault();
        pick(act);
      } else if (ev.key === "Escape") box.hidden = true;
    });
    inp.addEventListener("blur", () => {
      setTimeout(() => {
        box.hidden = true;
      }, 120);
    });
  }
  if (window.innerWidth < 640) elementById("hq").placeholder = "Search a gene, e.g. STM";
  attachSuggest("q", "sg-q");
  attachSuggest("hq", "sg-hq");
  function normalizeUppercase(s) {
    return String(s || "")
      .trim()
      .toUpperCase();
  }
  function normalizeSymbol(s) {
    return normalizeUppercase(s).replace(/\.\d+$/, "");
  }
  function buildSearchIndex() {
    for (const [rowIndex, row] of atlasState.idx.entries()) {
      atlasState.byId[row[0]] = rowIndex;
      const identifiers = [row[0]];
      for (const [id, symbol] of row[1]) identifiers.push(id, symbol);
      for (const ids of Object.values(row[3] || {})) identifiers.push(...ids);
      for (const id of identifiers) {
        const key = normalizeUppercase(id);
        if (!key) continue;
        for (const variant of new Set([key, normalizeSymbol(key)])) {
          indexUniqueValue(variant, rowIndex);
        }
      }
    }
  }
  function indexUniqueValue(k, i, T) {
    T = T || atlasState.lookup;
    (T[k] = T[k] || []).indexOf(i) < 0 && T[k].push(i);
  }
  function registerAliases(aliases) {
    for (const [label, groups] of Object.entries(aliases)) {
      for (const group of groups) {
        const position = atlasState.byId[group];
        if (position != null) indexUniqueValue(label, position, atlasState.alias);
      }
    }
  }
  function findOrthogroups(query) {
    const full = normalizeUppercase(query), short = normalizeSymbol(query);
    if (!short) return [];
    for (const index of [atlasState.lookup, atlasState.alias]) {
      for (const key of [full, short]) if (index[key]) return index[key];
    }
    const matches = [];
    const prefix = value => value && value.toUpperCase().startsWith(short);
    for (const [position, row] of atlasState.idx.entries()) {
      if (prefix(row[0]) || row[1].some(([, symbol, description]) =>
          prefix(symbol) || (short.length > 3 && description && description.toUpperCase().includes(short)))) {
        matches.push(position);
        if (matches.length === 25) break;
      }
    }
    return matches;
  }
  function searchAndDisplay(q) {
    let hits = findOrthogroups(q);
    if (hits.length !== 1) {
      atlasState.og = null;
      elementById("expr-card").hidden = true;
      elementById("q").value = q;
      if (atlasState.ready) setHash("gene/" + q);
    }
    if (!hits.length) {
      elementById("result").innerHTML =
        '<span class="status">No orthogroup matches “' +
        escapeMarkup(q) +
        "”. Try an Arabidopsis identifier such as AT1G62360, a symbol such as STM, or an orthogroup identifier.</span>";
      return;
    }
    if (hits.length === 1) return selectOrthogroup(hits[0], q);
    elementById("result").innerHTML =
      '<span class="status">' +
      hits.length +
      (hits.length >= 25 ? "+" : "") +
      " matches for “" +
      escapeMarkup(q) +
      '”. Pick one:</span><div class="matches">' +
      hits
        .map((i) => {
          let r = atlasState.idx[i];
          return (
            '<button type="button" data-i="' +
            i +
            '"><span class="sym">' +
            escapeMarkup(
              r[1]
                .map((m) => {
                  return m[1];
                })
                .filter((x) => {
                  return x;
                })
                .slice(0, 4)
                .join(", ") || r[0],
            ) +
            '</span> <span class="muted">' +
            escapeMarkup((r[1][0] || [])[2] || "") +
            '</span><span class="og">' +
            escapeMarkup(r[0]) +
            "</span></button>"
          );
        })
        .join("") +
      "</div>";
    elementById("result")
      .querySelectorAll(".matches button")
      .forEach((b) => {
        b.addEventListener("click", () => {
          selectOrthogroup(+b.dataset.i, q);
        });
      });
  }
  function isCore(s) {
    return !!(s && s[0] && s[1] && s[0][1] >= 30 && s[1][1] >= 20 && s[0][3] != null && s[1][3] != null && s[0][3] < 0.05 && s[1][3] < 0.05);
  }
  function selectOrthogroup(i, prefer) {
    atlasState.og = i;
    let r = atlasState.idx[i];
    let crops = r[3] || {},
      ck = Object.keys(crops);
    let syms = r[1]
      .map((m) => {
        return m[1];
      })
      .filter((x) => {
        return x;
      });
    let P = normalizeSymbol(prefer || ""),
      pm = P
        ? r[1].filter((m) => {
            return normalizeSymbol(m[1]) === P || normalizeSymbol(m[0]) === P;
          })[0]
        : null;
    if (pm && pm[1])
      syms = [pm[1]].concat(
        syms.filter((x) => {
          return x !== pm[1];
        }),
      );
    let desc = (pm && pm[2]) || (r[1][0] && r[1][0][2]) || "";
    let title = syms.length ? escapeMarkup(syms[0]) + (syms.length > 1 ? '<span class="also">with ' + escapeMarkup(syms.slice(1, 3).join(", ") + (syms.length > 3 ? ", …" : "")) + "</span>" : "") : escapeMarkup(r[0]);
    let s = atlasState.screen ? atlasState.screen.og[r[0]] : null;
    elementById("q").value = syms[0] || r[0];
    elementById("expr-card").hidden = false;
    if (atlasState.ready && !elementById("view-gene").hidden) setHash("gene/" + r[0]);
    elementById("result").innerHTML =
      '<div class="og-top"><div><div class="og-title"><h2>' +
      title +
      "</h2></div>" +
      (desc ? '<p class="desc">' + escapeMarkup(desc) + "</p>" : "") +
      "</div>" +
      (isCore(s) ? '<span class="badge" title="Higher in rhizomes than in both roots and aerial stems across species (FDR &lt; 0.05)">Rhizome-enriched</span>' : "") +
      "</div>" +
      renderTakeaways(s) +
      '<details class="info"><summary>Details: statistics, Arabidopsis genes' +
      (ck.length ? " and crop gene IDs" : "") +
      '</summary><div class="det-body">' +
      renderScreenFacts(s) +
      "<div><h4>Arabidopsis genes in orthogroup " +
      escapeMarkup(r[0]) +
      '</h4><div class="members">' +
      r[1]
        .map((m) => {
          return (
            '<span class="member" title="' +
            escapeMarkup(m[2]) +
            '">' +
            escapeMarkup(m[0]) +
            (m[1] ? "<i>" + escapeMarkup(m[1]) + "</i>" : "") +
            "</span>"
          );
        })
        .join("") +
      (r[2] > r[1].length ? '<span class="muted small">+' + (r[2] - r[1].length) + " more</span>" : "") +
      "</div></div>" +
      (ck.length
        ? '<div><h4>Gene IDs in crop genomes</h4><div class="crops-list">' +
          ck
            .map((c) => {
              return (
                '<div><span class="muted">' +
                escapeMarkup(atlasState.crops[c] || c) +
                ':</span> <span class="mono">' +
                escapeMarkup(crops[c].join(", ")) +
                "</span></div>"
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      "</div></details>";
    fetchExpressionChunk(Math.floor(i / atlasState.meta.chunk))
      .then(renderExpressionView)
      .catch((e) => {
        elementById("matrix-box").innerHTML =
          '<p class="status" style="padding:12px">Expression values could not be loaded (' +
          escapeMarkup(e.message) +
          ").</p>";
      });
  }
  function renderTakeaways(s) {
    if (!atlasState.screen) return "";
    if (!s) return '<p class="muted">Too few species have rhizome and comparator samples to compare this gene across species.</p>';
    function line(lab, d) {
      if (!d) return "";
      return (
        '<div class="tk"><span class="share"><i style="width:' +
        ((100 * d[0]) / d[1]).toFixed(1) +
        '%"></i><b></b></span><span>Higher in rhizome than in <b>' +
        lab +
        "</b> in <b>" +
        d[0] +
        " of " +
        d[1] +
        "</b> species</span></div>"
      );
    }
    return '<div class="takeaways">' + line("root", s[0]) + line("aerial stem", s[1]) + "</div>";
  }
  function renderScreenFacts(s) {
    let S = atlasState.screen;
    if (!S || !s) return "";
    let evaluable = s[0] && s[1] && s[0][1] >= 30 && s[1][1] >= 20;
    function fact(lab, d, repl) {
      if (!d) return '<div class="fact"><span class="k">' + lab + '</span><span class="v">–</span><span class="s">fewer than 5 species</span></div>';
      return (
        '<div class="fact"><span class="k">' +
        lab +
        '</span><span class="v">' +
        d[0] +
        " / " +
        d[1] +
        '<small>species</small></span><span class="s">median ' +
        (d[2] == null ? "–" : (d[2] >= 0 ? "+" : "") + d[2].toFixed(2)) +
        " · FDR " +
        formatPValue(d[3]) +
        (repl ? ' · <span class="rep" title="P &lt; 0.05 in monocots and in other lineages separately">replicated</span>' : "") +
        "</span></div>"
      );
    }
    let cls =
      s[4] != null
        ? '<div class="fact"><span class="k">Organ classifier, rhizome class</span><span class="v">#' +
          s[4].toLocaleString() +
          "<small>of " +
          S.features.toLocaleString() +
          '</small></span><span class="s">rank by classifier weight</span></div>'
        : '<div class="fact"><span class="k">Organ classifier, rhizome class</span><span class="v">–</span><span class="s">not used (detected in fewer than 75% of samples)</span></div>';
    return (
      '<div><h4>Rhizome versus comparators</h4><div class="facts">' +
      fact("Rhizome vs root", s[0], s[2]) +
      fact("Rhizome vs aerial stem", s[1], s[3]) +
      cls +
      '</div><p class="muted small" style="margin-top:6px">Matched-background residuals from same-study comparisons, one value per species; sign tests with Benjamini–Hochberg FDR.' +
      (evaluable ? "" : " Fewer species than the genome-wide core set requires (at least 30 with roots and 20 with aerial stems); read these counts as indicative.") +
      "</p></div>"
    );
  }
  function openOrthogroup(og) {
    let i = atlasState.byId[og];
    if (i == null) return;
    showView("gene");
    selectOrthogroup(i);
  }
  function orthogroupLabel(og) {
    let i = atlasState.byId[og],
      r = i == null ? null : atlasState.idx[i];
    if (!r) return og;
    let s = r[1]
      .map((m) => {
        return m[1];
      })
      .filter((x) => {
        return x;
      });
    return s.length ? s.slice(0, 3).join(", ") + (s.length > 3 ? ", …" : "") : og;
  }
  function renderOrganView() {
    let C = atlasState.clf;
    if (!C) return;
    let pct = (a, b) => {
      return Math.round((100 * a) / b) + "%";
    };
    elementById("organ-intro").textContent =
      "A classifier trained on rhizomes, aerial stems, roots and leaves (" +
      C.train.samples.toLocaleString() +
      " samples, " +
      C.train.species +
      " species, " +
      C.train.families +
      " families) tells these organs apart from expression alone, even in species it has never seen (balanced accuracy " +
      C.summary[0].ba.toFixed(2) +
      "). Below: where other underground organs fall, which genes mark rhizomes, and which sample labels may need checking.";
    let sw = C.summary[0],
      fam = C.summary[1],
      lo = Math.min(C.summary[2].ba, C.summary[3].ba).toFixed(2),
      hi = Math.max(C.summary[2].ba, C.summary[3].ba).toFixed(2);
    function kpi(v, l, s, tag, attr) {
      return "<" + (tag || "div") + ' class="kpi"' + (attr || "") + '><span class="v">' + v + '</span><span class="l">' + l + '</span><span class="s">' + s + "</span></" + (tag || "div") + ">";
    }
    elementById("organ-kpis").innerHTML =
      kpi(sw.ba.toFixed(2), "balanced accuracy in species never seen in training", "chance 0.25 · permuted labels at most " + C.null.max.toFixed(2)) +
      kpi(lo === hi ? lo : lo + "–" + hi, "across lineages: trained on monocots and tested on the rest, and the reverse", "family withheld " + fam.ba.toFixed(2)) +
      kpi(String(C.core.length), "orthogroups higher in rhizomes than in both roots and aerial stems", "of " + C.evaluable.toLocaleString() + " tested across species, FDR &lt; 0.05") +
      kpi(String(C.flags.n), "curated samples flagged for re-examination", "rule: curated organ P &lt; 0.1 and another organ P ≥ 0.8 · " + C.flags.consistent + " of " + C.flags.tested + " testable flags supported by marker genes →", "button", ' type="button" id="kpi-flags"');
    elementById("kpi-flags").addEventListener("click", openFlaggedSamples);
    elementById("organ-legend").innerHTML = organLegend();
    elementById("organ-storage").innerHTML = C.storage
      .map((s) => {
        return (
          '<div class="row"><span>' +
          escapeMarkup(s.label) +
          "</span>" +
          probabilityBar(
            s.p,
            ORGAN_CLASSES.map((c, k) => {
              return c[1] + " " + pct(s.p[k], 1);
            }).join(" · "),
          ) +
          '<span class="n">' +
          s.species +
          " spp.</span></div>"
        );
      })
      .join("");
    let o = C.origin;
    elementById("organ-origin").textContent =
      "Tubers and corms look most like rhizomes; storage roots fall between rhizome and root, reflecting their root origin. Bars average the predictions of models that never saw the species.";
    elementById("organ-origin-stats").innerHTML =
      "<b>Developmental origin.</b> Root probability is higher in root-derived storage organs (storage roots) than in stem-derived ones (tubers and corms): median " +
      o.all.med_root.toFixed(2) +
      " versus " +
      o.all.med_stem.toFixed(2) +
      " across " +
      o.all.n_root +
      " and " +
      o.all.n_stem +
      " species (AUC " +
      o.all.auc.toFixed(2) +
      ", P = " +
      formatPValue(o.all.p) +
      "); within eudicots " +
      o.eudicots.med_root.toFixed(2) +
      " versus " +
      o.eudicots.med_stem.toFixed(2) +
      " (P = " +
      formatPValue(o.eudicots.p) +
      ").";
    elementById("organ-core-sum").innerHTML =
      C.core.length +
      " of " +
      C.evaluable.toLocaleString() +
      " orthogroups tested across species (FDR &lt; 0.05). Numbers show in how many species each is higher in rhizome; " +
      '<span class="rep">●</span> replicated in monocots and in other lineages separately. Click a gene to open it.';
    elementById("organ-core").innerHTML = C.core
      .map((c) => {
        let i = atlasState.byId[c.og],
          r = i == null ? null : atlasState.idx[i],
          d = r && r[1][0] ? r[1][0][2] || "" : "";
        return (
          '<button type="button" data-og="' +
          escapeMarkup(c.og) +
          '"><b>' +
          escapeMarkup(orthogroupLabel(c.og)) +
          '</b><span class="c">root ' +
          c.root[0] +
          "/" +
          c.root[1] +
          " · stem " +
          c.stem[0] +
          "/" +
          c.stem[1] +
          (c.replicated ? ' <span class="rep">●</span>' : ' <span style="visibility:hidden">●</span>') +
          '</span><span class="d">' +
          escapeMarkup(d || c.og) +
          "</span></button>"
        );
      })
      .join("");
    elementById("organ-flags").innerHTML =
      "For " +
      '<b class="flag">' +
      C.flags.n +
      "</b> of " +
      C.train.samples.toLocaleString() +
      " training samples (" +
      ((100 * C.flags.n) / C.train.samples).toFixed(1) +
      "%), the model confidently predicts a different organ from the curated label. Where replicates allowed a check, marker genes supported the prediction for " +
      C.flags.consistent +
      " of " +
      C.flags.tested +
      ". These are candidates to re-examine; labels were not changed.";
    let CR = C.runs,
      curated = { rhizome: "Rhizome", stem: "Aerial stem", root: "Root", leaf: "Leaf" },
      cnt = {};
    (atlasState.runs || []).forEach((r) => {
      let c = CR[r[0]];
      if (c && c[5] === 1) {
        let k = (curated[r[2]] || r[2]) + " → " + ORGAN_CLASSES[c[0]][1];
        cnt[k] = (cnt[k] || 0) + 1;
      }
    });
    let pairs = Object.keys(cnt)
        .map((k) => {
          return [k, cnt[k]];
        })
        .sort((a, b) => {
          return b[1] - a[1];
        }),
      shown3 = pairs.slice(0, 3),
      rest = pairs.slice(3).reduce((a, p) => {
        return a + p[1];
      }, 0);
    if (rest) shown3.push(["Other shifts", rest]);
    let mx = Math.max.apply(
      null,
      shown3.map((p) => {
        return p[1];
      }).concat([1]),
    );
    elementById("organ-shifts").innerHTML = pairs.length
      ? '<div class="shifts"><h4>Curated label → predicted organ</h4>' +
        shown3
          .map((p) => {
            return '<div class="row"><span>' + escapeMarkup(p[0]) + '</span><span class="share"><i style="width:' + ((100 * p[1]) / mx).toFixed(1) + '%"></i></span><span class="n">' + p[1] + "</span></div>";
          })
          .join("") +
        "</div>"
      : "";
    elementById("organ-perf").innerHTML =
      '<thead><tr><th>Scheme</th><th class="num">Balanced accuracy</th><th class="num">Macro‑F1</th></tr></thead><tbody>' +
      C.summary
        .map((r) => {
          return "<tr><td>" + escapeMarkup(r.label) + '</td><td class="num">' + r.ba.toFixed(2) + '</td><td class="num">' + r.f1.toFixed(2) + "</td></tr>";
        })
        .join("") +
      "</tbody>";
    elementById("organ-null").textContent =
      "Permuted labels: mean balanced accuracy " + C.null.mean.toFixed(2) + " (maximum " + C.null.max.toFixed(2) + "); chance is 0.25.";
    elementById("organ-models").innerHTML =
      '<thead><tr><th>Model</th><th class="num">Species withheld</th><th class="num">Monocots → others</th><th class="num">Others → monocots</th></tr></thead><tbody>' +
      C.models
        .map((m) => {
          return (
            "<tr><td>" + escapeMarkup(m.model) + '</td><td class="num">' + m.loso.toFixed(2) + '</td><td class="num">' + m.m2o.toFixed(2) + '</td><td class="num">' + m.o2m.toFixed(2) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody>";
    elementById("organ-cm").innerHTML =
      "<thead><tr><th></th>" +
      ORGAN_CLASSES.map((c) => {
        return "<th>" + c[1] + "</th>";
      }).join("") +
      "</tr></thead><tbody>" +
      C.confusion
        .map((row, i) => {
          let tot = row.reduce((a, b) => {
            return a + b;
          }, 0);
          return (
            '<tr><th style="text-align:left">' +
            ORGAN_CLASSES[i][1] +
            "</th>" +
            row
              .map((v, j) => {
                return '<td class="' + (i === j ? "diag" : "") + '" title="' + v + ' samples">' + pct(v, tot) + "</td>";
              })
              .join("") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody>";
    elementById("organ-prot").innerHTML =
      '<thead><tr><th>Nearest proteome</th><th class="num">Samples</th><th class="num">Accuracy</th></tr></thead><tbody>' +
      C.proteome
        .map((p) => {
          return "<tr><td>" + escapeMarkup(p[0]) + '</td><td class="num">' + p[1] + '</td><td class="num">' + p[2].toFixed(2) + "</td></tr>";
        })
        .join("") +
      "</tbody>";
    elementById("organ-top").innerHTML = C.top
      .map((c) => {
        return '<button type="button" class="member" data-og="' + escapeMarkup(c.og) + '" title="' + escapeMarkup(c.og) + '">' + escapeMarkup(orthogroupLabel(c.og)) + "</button>";
      })
      .join("");
    ["organ-core", "organ-top"].forEach((id) => {
      elementById(id)
        .querySelectorAll("button[data-og]")
        .forEach((b) => {
          b.addEventListener("click", () => {
            openOrthogroup(b.dataset.og);
          });
        });
    });
  }
  function openFlaggedSamples() {
    elementById("sf").value = "flag";
    elementById("so").value = "";
    elementById("sq").value = "";
    showView("samples");
    window.scrollTo(0, 0);
  }
  elementById("flag-link").addEventListener("click", openFlaggedSamples);
  function fetchExpressionChunk(chunkId) {
    const cached = atlasState.chunk[chunkId];
    if (cached) return Promise.resolve(cached);
    const filename = String(chunkId).padStart(3, "0").slice(-3);
    return fetchDataset(`expr/${filename}.json`).then(payload => {
      const bytes = Uint8Array.from(atob(payload.v), c => c.charCodeAt(0));
      const reader = new DataView(bytes.buffer);
      const values = Uint16Array.from({length: bytes.length >> 1}, (_, i) => reader.getUint16(i * 2, true));
      return atlasState.chunk[chunkId] = {start: payload.start, v: values};
    });
  }
  function getExpressionValues(index) {
    const {chunk, units, scale} = atlasState.meta;
    const block = atlasState.chunk[Math.floor(index / chunk)];
    const start = (index - block.start) * units.length;
    return Array.from(block.v.subarray(start, start + units.length), value => value / scale);
  }
  ["filter", "mode"].forEach((id) => {
    elementById(id)
      .querySelectorAll("button")
      .forEach((b) => {
        b.addEventListener("click", () => {
          elementById(id)
            .querySelectorAll("button")
            .forEach((x) => {
              x.setAttribute("aria-pressed", x === b ? "true" : "false");
            });
          if (id === "filter") atlasState.filter = b.dataset.f;
          else atlasState.mode = b.dataset.m;
          if (atlasState.og != null) renderExpressionView();
        });
      });
  });
  let columnWidth = 24,
    rowHeight = 13,
    columnGap = 16;
  function renderExpressionView() {
    let m = atlasState.meta,
      i = atlasState.og,
      vals = getExpressionValues(i),
      lay = m.layouts[atlasState.filter],
      organs = m.organs,
      sp = lay.order;
    let cell = {};
    m.units.forEach((u, k) => {
      cell[u.species + "|" + u.organ] = { v: vals[k], n: u.runs, st: u.studies };
    });
    let info = {};
    m.species.forEach((s) => {
      info[s.name] = s;
    });
    let dcol = [
      ["rhizome", "stem", "Rhizome − aerial stem"],
      ["rhizome", "root", "Rhizome − root"],
    ];
    renderColorLegend();
    if (atlasState.mode === "table") return renderExpressionTable(sp, organs, cell, dcol);
    let narrow = elementById("matrix-box").clientWidth < 640;
    let treeW = narrow ? 6 : 130,
      nameW = narrow ? 150 : 214,
      hdrH = 136,
      padR = narrow ? 92 : 110;
    let x0 = treeW + nameW,
      xD = x0 + organs.length * columnWidth + columnGap,
      W = xD + dcol.length * columnWidth + padR,
      H = hdrH + sp.length * rowHeight + 14;
    let o = [
      '<svg id="mx" width="' +
        W +
        '" height="' +
        H +
        '" viewBox="0 0 ' +
        W +
        " " +
        H +
        '" role="img" aria-label="Expression of ' +
        escapeMarkup(atlasState.idx[i][0]) +
        ' by species and organ">',
      '<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--surface)"></rect><line x1="0" y1="0" x2="0" y2="4" stroke="var(--line)" stroke-width="1" opacity="0.7"></line></pattern></defs>',
    ];
    if (!narrow)
      lay.segs.forEach((s) => {
        let a = 8 + s[0] * (treeW - 16),
          b = 8 + s[2] * (treeW - 16);
        o.push(
          '<line class="edge" x1="' +
            a.toFixed(1) +
            '" y1="' +
            (hdrH + s[1] * rowHeight + rowHeight / 2).toFixed(1) +
            '" x2="' +
            b.toFixed(1) +
            '" y2="' +
            (hdrH + s[3] * rowHeight + rowHeight / 2).toFixed(1) +
            '"></line>',
        );
      });
    organs.forEach((g, k) => {
      let x = x0 + k * columnWidth + columnWidth / 2;
      o.push(
        '<text class="hdr" transform="translate(' +
          x +
          "," +
          (hdrH - 8) +
          ') rotate(-55)">' +
          escapeMarkup(g[1]) +
          "</text>",
      );
    });
    dcol.forEach((d, k) => {
      let x = xD + k * columnWidth + columnWidth / 2;
      o.push(
        '<text class="hdr" transform="translate(' +
          x +
          "," +
          (hdrH - 8) +
          ') rotate(-55)">' +
          escapeMarkup(d[2]) +
          "</text>",
      );
    });
    renderLineageMarkers(o, sp, info, hdrH, xD + dcol.length * columnWidth + 8, treeW);
    sp.forEach((s, r) => {
      let y = hdrH + r * rowHeight;
      o.push(
        '<text class="sp" x="' +
          (treeW + 4) +
          '" y="' +
          (y + rowHeight - 3) +
          '">' +
          escapeMarkup(s) +
          "</text>",
      );
      organs.forEach((g, k) => {
        let c = cell[s + "|" + g[0]],
          x = x0 + k * columnWidth;
        o.push(
          '<rect x="' +
            (x + 1) +
            '" y="' +
            (y + 1) +
            '" width="' +
            (columnWidth - 2) +
            '" height="' +
            (rowHeight - 2) +
            '" rx="1.5" fill="' +
            (c ? expressionFill(c.v) : "url(#hatch)") +
            '" data-s="' +
            r +
            '" data-k="' +
            k +
            '"></rect>',
        );
      });
      dcol.forEach((d, k) => {
        let a = cell[s + "|" + d[0]],
          b = cell[s + "|" + d[1]],
          x = xD + k * columnWidth;
        o.push(
          '<rect x="' +
            (x + 1) +
            '" y="' +
            (y + 1) +
            '" width="' +
            (columnWidth - 2) +
            '" height="' +
            (rowHeight - 2) +
            '" rx="1.5" fill="' +
            (a && b ? contrastFill(a.v - b.v) : "url(#hatch)") +
            '" data-s="' +
            r +
            '" data-d="' +
            k +
            '"></rect>',
        );
      });
    });
    o.push("</svg>");
    elementById("matrix-box").innerHTML = o.join("");
    let svg = elementById("mx"),
      tip = elementById("tip");
    svg.addEventListener("mousemove", (e) => {
      let t = e.target;
      if (t.tagName !== "rect" || t.dataset.s == null) {
        tip.hidden = true;
        return;
      }
      let s = sp[+t.dataset.s],
        html,
        li = info[s] || {};
      if (t.dataset.k != null) {
        let g = organs[+t.dataset.k],
          c = cell[s + "|" + g[0]];
        html =
          "<i>" +
          escapeMarkup(s) +
          '</i> <span class="muted">' +
          escapeMarkup(li.family || li.lineage || "") +
          "</span><br>" +
          (li.closest
            ? '<span class="muted">closest proteome: ' + escapeMarkup(li.closest) + "</span><br>"
            : "") +
          escapeMarkup(g[1]) +
          ": " +
          (c
            ? "<b>" +
              c.v.toFixed(2) +
              "</b> log2(CPM+1) · about " +
              Math.round(Math.pow(2, c.v) - 1) +
              ' CPM<br><span class="muted">' +
              c.n +
              (c.n === 1 ? " sample" : " samples") +
              ", " +
              c.st +
              (c.st === 1 ? " study" : " studies") +
              "</span>"
            : '<span class="muted">not sampled</span>');
      } else {
        let d = dcol[+t.dataset.d],
          a = cell[s + "|" + d[0]],
          b = cell[s + "|" + d[1]];
        html =
          "<i>" +
          escapeMarkup(s) +
          "</i><br>" +
          escapeMarkup(d[2]) +
          ": " +
          (a && b
            ? "<b>" +
              (a.v - b.v >= 0 ? "+" : "") +
              (a.v - b.v).toFixed(2) +
              '</b> log2 units<br><span class="muted">difference of species means</span>'
            : '<span class="muted">comparison not available</span>');
      }
      tip.innerHTML = html;
      tip.hidden = false;
      let x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8),
        y = e.clientY + 14;
      if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - 10;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
    svg.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  }
  function renderLineageMarkers(o, sp, info, hdrH, x, x1) {
    let blocks = [],
      cur = null;
    sp.forEach((s, r) => {
      let lin = (info[s] || {}).lineage || "";
      if (!cur || cur.lin !== lin) {
        cur = { lin: lin, a: r, b: r };
        blocks.push(cur);
      } else cur.b = r;
    });
    blocks.forEach((b, k) => {
      let ya = hdrH + b.a * rowHeight,
        yb = hdrH + (b.b + 1) * rowHeight;
      if (k > 0)
        o.push(
          '<line class="rule" x1="' +
            x1 +
            '" x2="' +
            (x - 2) +
            '" y1="' +
            ya +
            '" y2="' +
            ya +
            '"></line>',
        );
      if (b.b - b.a >= 1) {
        o.push(
          '<line class="edge" x1="' +
            x +
            '" x2="' +
            x +
            '" y1="' +
            (ya + 2) +
            '" y2="' +
            (yb - 2) +
            '"></line>',
        );
        o.push(
          '<text class="lin" x="' +
            (x + 6) +
            '" y="' +
            ((ya + yb) / 2 + 4) +
            '">' +
            escapeMarkup(b.lin) +
            "</text>",
        );
      }
    });
  }
  function renderExpressionTable(sp, organs, cell, dcol) {
    let h =
      '<table class="t"><thead><tr><th>Species</th>' +
      organs
        .map((g) => {
          return '<th class="num">' + escapeMarkup(g[1]) + "</th>";
        })
        .join("") +
      dcol
        .map((d) => {
          return '<th class="num">' + escapeMarkup(d[2]) + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>";
    sp.forEach((s) => {
      h +=
        "<tr><td><i>" +
        escapeMarkup(s) +
        "</i></td>" +
        organs
          .map((g) => {
            let c = cell[s + "|" + g[0]];
            return (
              '<td class="num">' +
              (c
                ? c.v.toFixed(2) + '<span class="muted"> (' + c.n + ")</span>"
                : '<span class="muted">–</span>') +
              "</td>"
            );
          })
          .join("") +
        dcol
          .map((d) => {
            let a = cell[s + "|" + d[0]],
              b = cell[s + "|" + d[1]];
            return (
              '<td class="num">' +
              (a && b
                ? (a.v - b.v >= 0 ? "+" : "") + (a.v - b.v).toFixed(2)
                : '<span class="muted">–</span>') +
              "</td>"
            );
          })
          .join("") +
        "</tr>";
    });
    elementById("matrix-box").innerHTML = h + "</tbody></table>";
  }
  function renderColorLegend() {
    elementById("legend").innerHTML =
      '<span class="bar">0<span class="grad" style="background:' +
      gradientBackground(colorScales.seq) +
      '"></span>' +
      expressionColorMax +
      "+ <span>log2(CPM+1), mean of samples</span></span>" +
      '<span class="bar">−' +
      contrastColorMax +
      '<span class="grad" style="background:' +
      gradientBackground(colorScales.div) +
      '"></span>+' +
      contrastColorMax +
      " <span>rhizome minus comparator</span></span>" +
      '<span class="bar"><span class="na"></span>not sampled</span>' +
      (atlasState.mode === "chart" ? '<span>Hover a cell for values</span>' : "");
  }
  let shown = 0,
    samplePageSize = 200,
    filtered = [];
  function renderSampleRows(reset) {
    if (!atlasState.runs) return;
    let CR = atlasState.clf ? atlasState.clf.runs : {};
    let curatedClass = { rhizome: 0, stem: 1, root: 2, leaf: 3 };
    if (reset) {
      let q = elementById("sq").value.trim().toLowerCase(),
        og = elementById("so").value,
        cf = elementById("sf").value;
      filtered = atlasState.runs.filter((r) => {
        let c = CR[r[0]];
        let keep =
          !cf ||
          (c &&
            ((cf === "flag" && c[5] === 1) ||
              (cf === "proj" && c[6] === 1) ||
              (cf === "mismatch" && c[6] === 0 && curatedClass[r[2]] !== c[0])));
        return (
          keep &&
          (!og || r[2] === og) &&
          (!q || (r[0] + " " + r[1] + " " + r[2] + " " + r[3]).toLowerCase().indexOf(q) >= 0)
        );
      });
      shown = 0;
    }
    let lab = {};
    atlasState.meta.organs.forEach((g) => {
      lab[g[0]] = g[1];
    });
    let next = filtered.slice(shown, shown + samplePageSize);
    shown += next.length;
    let rows = next
      .map((r) => {
        return (
          '<tr><td class="mono"><a href="https://www.ebi.ac.uk/ena/browser/view/' +
          escapeMarkup(r[0]) +
          '" target="_blank" rel="noopener">' +
          escapeMarkup(r[0]) +
          "</a></td><td><i>" +
          escapeMarkup(r[1]) +
          "</i></td><td>" +
          escapeMarkup(lab[r[2]] || r[2]) +
          '</td><td class="mono">' +
          escapeMarkup(r[3]) +
          '</td><td class="num">' +
          (r[4] == null ? "–" : r[4].toLocaleString()) +
          "</td><td>" +
          renderPredictionCell(CR[r[0]]) +
          "</td></tr>"
        );
      })
      .join("");
    if (reset)
      elementById("runs").innerHTML =
        '<thead><tr><th>Run</th><th>Species</th><th>Organ</th><th>Study</th><th class="num">Assigned reads</th><th>Classifier</th></tr></thead><tbody>' +
        rows +
        "</tbody>";
    else elementById("runs").querySelector("tbody").insertAdjacentHTML("beforeend", rows);
    elementById("more").hidden = shown >= filtered.length;
    elementById("samples-sum").innerHTML =
      "<b>" +
      filtered.length.toLocaleString() +
      "</b> of " +
      atlasState.runs.length.toLocaleString() +
      " samples. Every sample passed quality control and was quantified the same way; the classifier column comes from a model that had not seen the sample's species.";
  }
  function renderPredictionCell(c) {
    if (!c) return '<span class="muted">–</span>';
    let p = c.slice(1, 5),
      title = ORGAN_CLASSES.map((x, k) => {
        return x[1] + " " + (p[k] == null ? "–" : p[k].toFixed(2));
      }).join(", ");
    return (
      probabilityBar(p, title) +
      " " +
      escapeMarkup(ORGAN_CLASSES[c[0]][1]) +
      (c[5] === 1
        ? ' <span class="flag" title="Curated organ received a probability below 0.1 and another organ at least 0.8">⚑ check label' +
          (c[7] === 1 ? " · markers agree" : c[7] === 0 ? " · markers disagree" : "") +
          "</span>"
        : "") +
      (c[6] === 1 ? ' <span class="muted small">(not used for training)</span>' : "")
    );
  }
  elementById("sq").addEventListener("input", () => {
    renderSampleRows(true);
  });
  elementById("sf").addEventListener("change", () => {
    renderSampleRows(true);
  });
  elementById("so").addEventListener("change", () => {
    renderSampleRows(true);
  });
  elementById("more").addEventListener("click", () => {
    renderSampleRows(false);
  });
  function renderAboutSection() {
    let m = atlasState.meta;
    elementById("about").innerHTML =
      "<h2>About RhizoAtlas</h2>" +
      "<p>RhizoAtlas brings together " +
      m.n_runs.toLocaleString() +
      " public RNA-seq samples from " +
      m.n_studies +
      " studies and " +
      m.species.length +
      " species: rhizomes, aerial stems, roots and leaves, and other storage organs such as tubers, storage roots, corms and bulbs. Every sample was quantified the same way, so values can be compared across species.</p>" +
      "<h3>How to use</h3><ol>" +
      "<li>Type a gene symbol (STM), an Arabidopsis identifier (AT1G62360) or a crop gene ID in the search box and pick a suggestion.</li>" +
      "<li>Read the summary line: in how many species the gene is higher in rhizome than in root and in aerial stem.</li>" +
      "<li>Scan the heatmap: one row per species, one column per organ; hover a cell for values. Open Details for statistics and gene IDs.</li>" +
      "<li>Each result has its own link, so you can bookmark or share it.</li></ol>" +
      "<h3>Tools</h3><dl>" +
      "<dt>Score a gene set</dt><dd>Paste any list of genes to test whether it is higher in rhizomes than in roots and aerial stems across species, with the matched-background method of the article's trait indices. The examples reproduce the published scores for class I KNOX genes, sugar import, starch synthesis and the soil interface.</dd>" +
      "<dt>Find candidate genes</dt><dd>Rank gene families by how consistently they differ between rhizome and root or aerial stem across species, choose the lineage and threshold, and download the list with gene IDs in ginger, turmeric, lotus, Coptis and banana.</dd>" +
      "<dt>Analyze your data</dt><dd>Upload a gene count table (Arabidopsis identifiers, gene IDs from the ginger, turmeric, lotus, Coptis or banana genome, or orthogroups). Every sample gets calibrated probabilities of being rhizome, aerial stem, root or leaf, with warnings for low depth, missing genes or unusual profiles. When the experiment includes rhizome with root or aerial stem, it is profiled with the article's method: trait indices against the atlas species, agreement with the cross-species rhizome signature, core genes and the most similar atlas species. The data stay in your browser.</dd>" +
      "<dt>Organ identity</dt><dd>Where tubers, corms, bulbs, storage roots and other organs fall on the same scale, and which atlas sample labels may need checking.</dd>" +
      "<dt>Samples</dt><dd>Every run with its curated organ, study and predicted organ, linked to its ENA record.</dd></dl>" +
      "<h3>How values were obtained</h3><ul>" +
      "<li>Organ labels were curated from the public sample and study records; samples that failed quality control or curation were removed.</li>" +
      "<li>Reads were assigned to proteins of annotated plant genomes and counted per orthogroup.</li>" +
      "<li>Values are log2(counts per million + 1), averaged over the samples of a species and organ. The rhizome-minus-comparator columns of the heatmap are simple differences of these means; the summary line, the trait scores and the organ model use matched or species-withheld analyses described in the accompanying article.</li>" +
      "<li>Species are ordered by the species tree: " +
      escapeMarkup(m.tree_source) +
      ".</li></ul>" +
      "<h3>Command line and data files</h3>" +
      '<p>For many files or automated pipelines, download <a href="tools/rhizoatlas.py" download>rhizoatlas.py</a> (Python 3, standard library only). It runs the same four analyses as this site (<span class="mono">classify</span>, <span class="mono">analyze</span>, <span class="mono">score</span>, <span class="mono">candidates</span>) on the same data files and gives the same results. Point it at this site with <span class="mono">--data ' +
      escapeMarkup(location.origin + location.pathname.replace(/[^/]*$/, "") + "data/") +
      "</span> or at a local copy of the data folder.</p><dl>" +
      "<dt class=\"mono\">meta.json</dt><dd>species, organs, expression units and species-tree layouts</dd>" +
      "<dt class=\"mono\">og_index.json</dt><dd>orthogroups with Arabidopsis members, symbols, descriptions and crop gene IDs</dd>" +
      "<dt class=\"mono\">expr/NNN.json</dt><dd>mean log2(CPM + 1) by species and organ, 500 orthogroups per file (uint16 × 1000, base64)</dd>" +
      "<dt class=\"mono\">resid.json</dt><dd>study-level matched-background residuals of every orthogroup against root and aerial stem (int16 × 1000, base64)</dd>" +
      "<dt class=\"mono\">clf_model.json</dt><dd>organ-identity models for each input type, with calibration, thresholds and validation</dd>" +
      "<dt class=\"mono\">classifier.json · screen.json · layers.json · runs.json</dt><dd>classifier results and per-sample predictions, genome-wide screen, published trait indices and tests, sample list</dd></dl>" +
      "<h3>Data and citation</h3><p>Count matrices, sample metadata, gene sets, trait scores, classifier predictions, the genome-wide screen and analysis code are deposited at Zenodo under CC BY 4.0; the DOI is given in the accompanying article.</p>";
  }
  /* ---------- cross-species tools: shared data ---------- */
  let RES = null,
    resLoading = null;
  let LOGF = [0];
  for (let i = 1; i <= 400; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
  function signP(k, n) {
    if (!(n > 0)) return NaN;
    let p = 0;
    for (let i = k; i <= n; i++) p += Math.exp(LOGF[n] - LOGF[i] - LOGF[n - i] - n * Math.LN2);
    return Math.min(1, p);
  }
  function bhAdjust(probabilities) {
    const ordered = Array.from(probabilities, (p, index) => ({p, index}))
      .filter(record => !Number.isNaN(record.p)).sort((a, b) => a.p - b.p);
    const adjusted = new Float64Array(probabilities.length).fill(NaN);
    let ceiling = Infinity;
    for (let rank = ordered.length; rank > 0; rank--) {
      const {p, index} = ordered[rank - 1];
      ceiling = Math.min(ceiling, p * ordered.length / rank);
      adjusted[index] = Math.min(ceiling, 1);
    }
    return adjusted;
  }
  function medianOf(values) {
    const size = values.length;
    if (size === 0) return NaN;
    values.sort((a, b) => a - b);
    const right = Math.floor(size / 2);
    return size % 2 === 0 ? (values[right - 1] + values[right]) / 2 : values[right];
  }
  function ogName(n) {
    return "OG" + ("000000" + n).slice(-7);
  }
  function loadResiduals() {
    if (RES !== null) return Promise.resolve(RES);
    if (resLoading) return resLoading;
    resLoading = fetchDataset("resid.json").then(data => {
      const col = Object.fromEntries(data.ogs.map((id, i) => [ogName(id), i]));
      const comp = {};
      for (const organ of ["root", "stem"]) {
        const {units, v} = data[organ];
        const raw = Uint8Array.from(atob(v), ch => ch.charCodeAt(0));
        const reader = new DataView(raw.buffer);
        const matrix = new Float32Array(units.length * data.ogs.length);
        for (let i = 0; i < matrix.length; i++) {
          const value = reader.getInt16(2 * i, true);
          matrix[i] = value === -32768 ? NaN : value / data.scale;
        }
        const bySpecies = {};
        for (const [i, unit] of units.entries()) (bySpecies[unit[0]] ||= []).push(i);
        comp[organ] = {M: matrix, nU: units.length, spU: bySpecies,
          spList: Object.keys(bySpecies).map(Number).sort((a,b) => a-b), S: null};
      }
      return RES = {ogs: data.ogs, nO: data.ogs.length, col, species: data.species, lineage: data.lineage, comp};
    });
    return resLoading;
  }
  function speciesMedians(comparison) {
    const block = RES.comp[comparison], width = RES.nO;
    if (block.S) return block.S;
    const output = new Float32Array(block.spList.length * width);
    for (const [row, species] of block.spList.entries()) {
      const units = block.spU[species];
      if (units.length === 1) {
        output.set(block.M.subarray(units[0] * width, (units[0] + 1) * width), row * width);
        continue;
      }
      for (let column = 0; column < width; column++) {
        const values = [];
        for (const unit of units) {
          const value = block.M[unit * width + column];
          if (!Number.isNaN(value)) values.push(value);
        }
        output[row * width + column] = medianOf(values);
      }
    }
    return block.S = output;
  }
  function downloadText(name, text) {
    let a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function csvCell(v) {
    v = v == null || (typeof v === "number" && v !== v) ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  let CROP_NAMES = {
    Zinoff: "Zingiber officinale (ginger)",
    Curlon: "Curcuma longa (turmeric)",
    Nelnuc: "Nelumbo nucifera (lotus)",
    Copchi: "Coptis chinensis",
    Musacu: "Musa acuminata (banana)",
  };
  let fmt2 = (v) => {
    return v == null || v !== v ? "–" : (v >= 0 ? "+" : "") + v.toFixed(2);
  };

  /* ---------- Score a gene set ---------- */
  let scoreState = { init: false, last: null };
  let SET_NOTES = {
    "Class I KNOX": "Stem-meristem identity",
    "Sugar import": "Sucrose import and use",
    "Starch synthesis": "Reserve accumulation",
    "Soil interface": "Program shared with roots",
  };
  let EXTRA_SETS = {
    "Hypoxia core genes": {
      note: "49 genes induced by hypoxia in all cell types of Arabidopsis seedlings (Mustroph et al., 2009)",
      genes: ["AT1G17290", "AT1G19530", "AT1G26270", "AT1G33055", "AT1G35140", "AT1G43800", "AT1G55810", "AT1G63090", "AT1G72940", "AT1G74940", "AT1G76650", "AT1G77120", "AT2G16060", "AT2G17850", "AT2G19590", "AT2G34390", "AT2G47520", "AT3G02550", "AT3G10040", "AT3G17860", "AT3G23150", "AT3G23170", "AT3G27220", "AT3G43190", "AT3G61060", "AT4G10270", "AT4G17670", "AT4G22780", "AT4G24110", "AT4G27450", "AT4G32840", "AT4G33070", "AT4G33560", "AT4G39675", "AT5G02200", "AT5G10040", "AT5G15120", "AT5G26200", "AT5G39890", "AT5G42200", "AT5G44730", "AT5G45340", "AT5G47060", "AT5G47910", "AT5G54960", "AT5G58070", "AT5G61440", "AT5G62520", "AT5G66985"],
    },
  };
  function renderScoreView() {
    if (!scoreState.init) {
      scoreState.init = true;
      let L = atlasState.layers;
      elementById("gs-presets").innerHTML =
        '<span class="muted small">Examples:</span> ' +
        Object.keys(L.sets)
          .map((k) => {
            return '<button type="button" class="chip" data-set="' + escapeMarkup(k) + '" title="' + escapeMarkup(SET_NOTES[k] || "") + '">' + escapeMarkup(k) + "</button>";
          })
          .join(" ") +
        " " +
        Object.keys(EXTRA_SETS)
          .map((k) => {
            return '<button type="button" class="chip" data-extra="' + escapeMarkup(k) + '" title="' + escapeMarkup(EXTRA_SETS[k].note) + '">' + escapeMarkup(k) + "</button>";
          })
          .join(" ");
      elementById("gs-presets")
        .querySelectorAll("button[data-set]")
        .forEach((b) => {
          b.addEventListener("click", () => {
            elementById("gs-in").value = L.sets[b.dataset.set].join("\n");
            runScore(b.dataset.set);
          });
        });
      elementById("gs-presets")
        .querySelectorAll("button[data-extra]")
        .forEach((b) => {
          b.addEventListener("click", () => {
            elementById("gs-in").value = EXTRA_SETS[b.dataset.extra].genes.join("\n");
            runScore(b.dataset.extra);
          });
        });
      elementById("gs-run").addEventListener("click", () => {
        runScore(null);
      });
      elementById("gs-in").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runScore(null);
      });
      elementById("gs-dl").addEventListener("click", () => {
        let r = scoreState.last;
        if (!r) return;
        let lines = [["species", "lineage", "score_vs_root", "score_vs_aerial_stem"].join(",")];
        atlasState.layers.layout.order.forEach((name) => {
          let si = RES.species.indexOf(name);
          lines.push([name, RES.lineage[si], r.root.sp[si], r.stem.sp[si]].map(csvCell).join(","));
        });
        downloadText("rhizoatlas_gene_set_scores.csv", lines.join("\n"));
      });
      elementById("tests").innerHTML =
        '<thead><tr><th>Comparison</th><th>Species higher in rhizome</th><th class="num">Sign test P</th><th class="num">PGLS P</th></tr></thead><tbody>' +
        L.tests
          .map((t) => {
            return (
              '<tr title="' +
              (t.lam == null ? "" : "Phylogenetic signal λ = " + t.lam.toFixed(2)) +
              '"><td>' +
              escapeMarkup(t.label) +
              "</td><td>" +
              (t.higher == null ? "–" : '<span class="share mini"><i style="width:' + ((100 * t.higher) / t.n).toFixed(1) + '%"></i><b></b></span>' + t.higher + " / " + t.n) +
              '</td><td class="num">' +
              formatPValue(t.p_sign) +
              '</td><td class="num">' +
              formatPValue(t.p_pgls) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody>";
      let first = Object.keys(L.sets)[0];
      elementById("gs-in").value = L.sets[first].join("\n");
      runScore(first);
    } else if (scoreState.last) drawScoreHeatmap(scoreState.last);
  }
  function parseGeneList(text) {
    const tokens = text.split(/[\s,;]+/).map(token => token.trim()).filter(Boolean);
    const groups = new Set(), miss = [];
    for (const token of tokens) {
      const full = normalizeUppercase(token), short = normalizeSymbol(token);
      const match = atlasState.lookup[full] || atlasState.lookup[short] || atlasState.alias[full] || atlasState.alias[short];
      if (!match || !match.length) { miss.push(token); continue; }
      for (const index of match) groups.add(atlasState.idx[index][0]);
    }
    return {n: tokens.length, ogs: [...groups], miss};
  }
  function scoreGeneSet(groups) {
    const columns = groups.map(group => RES.col[group]).filter(column => column != null);
    const output = {used: columns.length};
    for (const comparison of ["root", "stem"]) {
      const block = RES.comp[comparison];
      const unitScores = Array.from({length: block.nU}, (_, unit) => {
        const values = columns.map(column => block.M[unit * RES.nO + column]).filter(value => !Number.isNaN(value));
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
      });
      const sp = {}, values = [], mono = [0,0], oth = [0,0];
      let positive = 0;
      for (const species of block.spList) {
        const score = medianOf(block.spU[species].map(unit => unitScores[unit]).filter(value => !Number.isNaN(value)));
        sp[species] = score;
        if (Number.isNaN(score)) continue;
        values.push(score);
        const tally = RES.lineage[species] === "monocots" ? mono : oth;
        tally[1]++;
        if (score > 0) { positive++; tally[0]++; }
      }
      output[comparison] = {sp, n: values.length, k: positive, p: signP(positive, values.length), med: medianOf(values), mono, oth};
    }
    return output;
  }
  function runScore(presetName) {
    let parsed = parseGeneList(elementById("gs-in").value);
    let msg = elementById("gs-map");
    if (!parsed.ogs.length) {
      msg.innerHTML = parsed.n ? "No entry matched a gene in the atlas." : "Paste at least one gene.";
      elementById("gs-out").hidden = true;
      return;
    }
    msg.textContent = "Loading cross-species data…";
    loadResiduals()
      .then(() => {
        let r = scoreGeneSet(parsed.ogs);
        if (!r.used) {
          msg.textContent = "None of these orthogroups is expressed in the rhizome comparisons.";
          elementById("gs-out").hidden = true;
          return;
        }
        r.name = presetName;
        scoreState.last = r;
        msg.innerHTML =
          (presetName ? "<b>" + escapeMarkup(presetName) + "</b> · " : "") +
          parsed.n +
          " entr" +
          (parsed.n === 1 ? "y" : "ies") +
          " → " +
          parsed.ogs.length +
          " orthogroup" +
          (parsed.ogs.length === 1 ? "" : "s") +
          (r.used < parsed.ogs.length ? " (" + r.used + " expressed in the comparisons)" : "") +
          (parsed.miss.length
            ? ' · <span class="flag">not found: ' + escapeMarkup(parsed.miss.slice(0, 6).join(", ") + (parsed.miss.length > 6 ? " +" + (parsed.miss.length - 6) : "")) + "</span>"
            : "");
        function tile(lab, x) {
          return (
            '<div class="card restile"><span class="k">' +
            lab +
            '</span><span class="v">' +
            x.k +
            " / " +
            x.n +
            '<small>species higher in rhizome</small></span><span class="share"><i style="width:' +
            (x.n ? (100 * x.k) / x.n : 0).toFixed(1) +
            '%"></i><b></b></span><span class="s">sign test P = ' +
            formatPValue(x.p) +
            " · median score " +
            fmt2(x.med) +
            '</span><span class="s">monocots ' +
            x.mono[0] +
            "/" +
            x.mono[1] +
            " · other lineages " +
            x.oth[0] +
            "/" +
            x.oth[1] +
            "</span></div>"
          );
        }
        elementById("gs-tiles").innerHTML = tile("Rhizome vs root", r.root) + tile("Rhizome vs aerial stem", r.stem);
        elementById("gs-out").hidden = false;
        drawScoreHeatmap(r);
      })
      .catch((e) => {
        msg.textContent = "The cross-species data could not be loaded (" + e.message + ").";
      });
  }
  function drawScoreHeatmap(r) {
    let lay = atlasState.layers.layout,
      sp = lay.order,
      cols = [
        ["root", "vs root"],
        ["stem", "vs aerial stem"],
      ],
      cmax = 1.5;
    elementById("gs-legend").innerHTML =
      '<span class="bar">−' +
      cmax +
      '<span class="grad" style="background:' +
      gradientBackground(colorScales.div) +
      '"></span>+' +
      cmax +
      ' <span>lower ← → higher in rhizome (log2, beyond matched genes)</span></span><span class="bar"><span class="na"></span>not compared</span><span>Hover a cell for values</span>';
    let narrow = elementById("gs-box").clientWidth < 560,
      treeW = narrow ? 6 : 130,
      nameW = narrow ? 150 : 214,
      hdrH = 96,
      cw = 40,
      x0 = treeW + nameW,
      W = x0 + cols.length * cw + 120,
      H = hdrH + sp.length * rowHeight + 14;
    let info = {};
    atlasState.meta.species.forEach((s) => {
      info[s.name] = s;
    });
    let o = [
      '<svg id="gsx" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Gene-set scores by species"><defs><pattern id="hatch3" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--surface)"></rect><line x1="0" y1="0" x2="0" y2="4" stroke="var(--line)" stroke-width="1" opacity="0.7"></line></pattern></defs>',
    ];
    if (!narrow)
      lay.segs.forEach((s) => {
        let a = 8 + s[0] * (treeW - 16),
          b = 8 + s[2] * (treeW - 16);
        o.push('<line class="edge" x1="' + a.toFixed(1) + '" y1="' + (hdrH + s[1] * rowHeight + rowHeight / 2).toFixed(1) + '" x2="' + b.toFixed(1) + '" y2="' + (hdrH + s[3] * rowHeight + rowHeight / 2).toFixed(1) + '"></line>');
      });
    cols.forEach((c, k) => {
      o.push('<text class="hdr" transform="translate(' + (x0 + k * cw + cw / 2) + "," + (hdrH - 8) + ') rotate(-55)">' + c[1] + "</text>");
    });
    renderLineageMarkers(o, sp, info, hdrH, x0 + cols.length * cw + 8, treeW);
    sp.forEach((name, row) => {
      let y = hdrH + row * rowHeight,
        si = RES.species.indexOf(name);
      o.push('<text class="sp" x="' + (treeW + 4) + '" y="' + (y + rowHeight - 3) + '">' + escapeMarkup(name) + "</text>");
      cols.forEach((c, k) => {
        let v = r[c[0]].sp[si];
        o.push(
          '<rect x="' + (x0 + k * cw + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (rowHeight - 2) + '" rx="1.5" fill="' + (v == null || v !== v ? "url(#hatch3)" : contrastFill(v, cmax)) + '" data-s="' + row + '" data-k="' + k + '"></rect>',
        );
      });
    });
    o.push("</svg>");
    elementById("gs-box").innerHTML = o.join("");
    let svg = elementById("gsx"),
      tip = elementById("tip");
    svg.addEventListener("mousemove", (e) => {
      let t = e.target;
      if (t.tagName !== "rect" || t.dataset.s == null) {
        tip.hidden = true;
        return;
      }
      let name = sp[+t.dataset.s],
        c = cols[+t.dataset.k],
        v = r[c[0]].sp[RES.species.indexOf(name)];
      tip.innerHTML = "<i>" + escapeMarkup(name) + "</i><br>Rhizome " + c[1] + ": " + (v == null || v !== v ? '<span class="muted">not compared</span>' : "<b>" + fmt2(v) + "</b>");
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    svg.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  }

  /* ---------- Find candidate genes ---------- */
  let findState = { init: false, rows: null, opt: null };
  function segValue(id) {
    let b = elementById(id).querySelector('button[aria-pressed="true"]');
    return b ? b.dataset.v : null;
  }
  function renderFindView() {
    if (!findState.init) {
      findState.init = true;
      ["fd-comp", "fd-dir", "fd-grp"].forEach((id) => {
        elementById(id)
          .querySelectorAll("button")
          .forEach((b) => {
            b.addEventListener("click", () => {
              elementById(id)
                .querySelectorAll("button")
                .forEach((x) => {
                  x.setAttribute("aria-pressed", x === b ? "true" : "false");
                });
              runFind();
            });
          });
      });
      let sel = elementById("fd-crop");
      sel.innerHTML = Object.keys(CROP_NAMES)
        .map((k) => {
          return '<option value="' + k + '">' + CROP_NAMES[k] + "</option>";
        })
        .join("");
      sel.addEventListener("change", () => {
        drawFindTable();
      });
      elementById("fd-fdr").addEventListener("change", runFind);
      elementById("fd-dl").addEventListener("click", downloadFind);
      runFind();
    }
  }
  function runFind() {
    const opt = {comp: segValue("fd-comp"), dir: segValue("fd-dir"), grp: segValue("fd-grp"), fdr: +elementById("fd-fdr").value};
    elementById("fd-count").textContent = "Loading cross-species data…";
    function summarize(comparison) {
      const block = RES.comp[comparison], width = RES.nO, matrix = speciesMedians(comparison);
      const selected = block.spList.flatMap((species, index) =>
        opt.grp === "all" || RES.lineage[species] === opt.grp
          ? [{offset: index * width, lineage: RES.lineage[species] === "monocots" ? 0 : 1}] : []);
      const N = new Int16Array(width), K = new Int16Array(width), P = new Float64Array(width);
      const Med = new Float32Array(width), rep = new Uint8Array(width);
      const directionMatches = opt.dir === "up" ? value => value > 0 : value => value < 0;
      for (let column = 0; column < width; column++) {
        const measured = [], totals = [0,0], positives = [0,0];
        for (const {offset, lineage} of selected) {
          const value = matrix[offset + column];
          if (Number.isNaN(value)) continue;
          measured.push(value);
          totals[lineage]++;
          if (directionMatches(value)) positives[lineage]++;
        }
        const n = measured.length, k = positives[0] + positives[1];
        N[column] = n; K[column] = k;
        P[column] = n >= 5 ? signP(k, n) : NaN;
        Med[column] = medianOf(measured);
        rep[column] = opt.grp === "all" && totals.every((total, i) => total >= 5 && signP(positives[i], total) < 0.05) ? 1 : 0;
      }
      const nG = selected.length;
      return {N, K, P, Q: bhAdjust(P), Med, rep, minN: Math.ceil(0.65*nG - 1e-9), nG};
    }
    loadResiduals().then(() => {
      const comps = opt.comp === "both" ? ["root", "stem"] : [opt.comp];
      const st = Object.fromEntries(comps.map(comparison => [comparison, summarize(comparison)]));
      const statistics = comps.map(comparison => st[comparison]);
      const rows = [];
      for (let j = 0; j < RES.nO; j++) {
        if (!statistics.every(result => result.N[j] >= result.minN && result.Q[j] < opt.fdr)) continue;
        rows.push({j, og: ogName(RES.ogs[j]), q: Math.max(...statistics.map(result => result.Q[j])),
          p: Math.max(...statistics.map(result => result.P[j])), rep: statistics.every(result => result.rep[j] === 1)});
      }
      rows.sort((left, right) => left.q - right.q || left.p - right.p);
      Object.assign(findState, {rows, opt, st, comps});
      drawFindTable();
    }).catch(error => {
      elementById("fd-count").textContent = "The cross-species data could not be loaded (" + error.message + ").";
    });
  }
  function drawFindTable() {
    let rows = findState.rows,
      opt = findState.opt,
      st = findState.st,
      comps = findState.comps,
      crop = elementById("fd-crop").value;
    if (!rows) return;
    let word = opt.dir === "up" ? "higher" : "lower";
    elementById("fd-count").textContent =
      rows.length.toLocaleString() + " gene famil" + (rows.length === 1 ? "y" : "ies") + " " + word + " in rhizome" + (rows.length > 300 ? " (top 300 shown; download for all)" : "");
    let compLab = { root: "vs root", stem: "vs aerial stem" };
    let head =
      "<thead><tr><th>#</th><th>Gene</th><th>Description</th>" +
      comps
        .map((c) => {
          return '<th class="num" title="species ' + word + ' in rhizome / species tested">' + compLab[c] + "</th>";
        })
        .join("") +
      '<th class="num">FDR</th>' +
      (opt.grp === "all" ? '<th title="P &lt; 0.05 in monocots and in other lineages separately">Repl.</th>' : "") +
      "<th>" +
      escapeMarkup((CROP_NAMES[crop] || crop).replace(/ \(.*\)/, "")) +
      " IDs</th></tr></thead><tbody>";
    let body = rows
      .slice(0, 300)
      .map((r, n) => {
        let i = atlasState.byId[r.og],
          x = i == null ? null : atlasState.idx[i],
          desc = x && x[1][0] ? x[1][0][2] || "" : "",
          ids = x && x[3] && x[3][crop] ? x[3][crop] : [];
        return (
          '<tr><td class="muted">' +
          (n + 1) +
          '</td><td><button type="button" class="member" data-og="' +
          r.og +
          '" title="' +
          r.og +
          '">' +
          escapeMarkup(orthogroupLabel(r.og)) +
          '</button></td><td class="desc-cell">' +
          escapeMarkup(desc) +
          "</td>" +
          comps
            .map((c) => {
              return '<td class="num">' + st[c].K[r.j] + "/" + st[c].N[r.j] + "</td>";
            })
            .join("") +
          '<td class="num">' +
          formatPValue(r.q) +
          "</td>" +
          (opt.grp === "all" ? '<td class="rep">' + (r.rep ? "●" : "") + "</td>" : "") +
          '<td class="mono small">' +
          (ids.length ? escapeMarkup(ids.slice(0, 2).join(", ")) + (ids.length > 2 ? ' <span class="muted">+' + (ids.length - 2) + "</span>" : "") : '<span class="muted">–</span>') +
          "</td></tr>"
        );
      })
      .join("");
    elementById("fd-table").innerHTML = head + (body || '<tr><td colspan="8" class="muted">No gene family passes these settings.</td></tr>') + "</tbody>";
    elementById("fd-table")
      .querySelectorAll("button[data-og]")
      .forEach((b) => {
        b.addEventListener("click", () => {
          openOrthogroup(b.dataset.og);
        });
      });
    elementById("fd-note").textContent =
      "Each gene family must be tested in at least 65% of the species in the group (" +
      comps
        .map((c) => {
          return compLab[c].replace("vs ", "") + ": " + st[c].minN + " of " + st[c].nG;
        })
        .join("; ") +
      "). One-sided sign tests across species on matched-background residuals, with Benjamini–Hochberg FDR over all gene families tested in at least five species" +
      (opt.grp === "all" ? "; ● replicated: P < 0.05 in monocots and in other lineages separately." : ".");
  }
  function downloadFind() {
    let rows = findState.rows,
      st = findState.st,
      comps = findState.comps;
    if (!rows) return;
    let codes = Object.keys(CROP_NAMES);
    let head = ["orthogroup", "arabidopsis_symbols", "description"];
    comps.forEach((c) => {
      head.push(c + "_species_tested", c + "_species_" + (findState.opt.dir === "up" ? "higher" : "lower"), c + "_median_residual", c + "_P", c + "_FDR");
    });
    head.push("replicated_in_both_lineage_groups");
    codes.forEach((k) => {
      head.push(CROP_NAMES[k].replace(/ \(.*\)/, "").replace(" ", "_") + "_gene_ids");
    });
    let lines = [head.join(",")];
    rows.forEach((r) => {
      let i = atlasState.byId[r.og],
        x = i == null ? null : atlasState.idx[i];
      let rec = [
        r.og,
        x
          ? x[1]
              .map((m) => {
                return m[1];
              })
              .filter((s) => {
                return s;
              })
              .join(";")
          : "",
        x && x[1][0] ? x[1][0][2] : "",
      ];
      comps.forEach((c) => {
        rec.push(st[c].N[r.j], st[c].K[r.j], st[c].Med[r.j].toFixed(3), st[c].P[r.j].toPrecision(3), st[c].Q[r.j].toPrecision(3));
      });
      rec.push(findState.opt.grp === "all" ? (r.rep ? "yes" : "no") : "");
      codes.forEach((k) => {
        rec.push(x && x[3] && x[3][k] ? x[3][k].join(";") : "");
      });
      lines.push(rec.map(csvCell).join(","));
    });
    downloadText("rhizoatlas_candidates.csv", lines.join("\n"));
  }
  /* ---------- Analyze your data ---------- */
  let CLF = null,
    clfLoading = null,
    anState = { init: false, tab: null, mp: null, cls: null, organs: null, report: null };
  let ROUTE_LABEL = {
    og: "RhizoAtlas orthogroups",
    arabidopsis: "Arabidopsis identifiers",
    Zinoff: "Zingiber officinale (ginger) gene IDs",
    Curlon: "Curcuma longa (turmeric) gene IDs",
    Nelnuc: "Nelumbo nucifera (lotus) gene IDs",
    Copchi: "Coptis chinensis gene IDs",
    Musacu: "Musa acuminata (banana) gene IDs",
  };
  let ORG_KEYS = ["rhizome", "stem", "root", "leaf"];
  function decodeF32(s) {
    let b = atob(s),
      buf = new ArrayBuffer(b.length),
      u8 = new Uint8Array(buf);
    for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    return new Float32Array(buf);
  }
  function loadClassifier() {
    if (CLF) return Promise.resolve(CLF);
    if (clfLoading) return clfLoading;
    clfLoading = fetchDataset("clf_model.json").then((m) => {
      Object.keys(m.routes).forEach((k) => {
        let r = m.routes[k];
        r.W = decodeF32(r.w);
        if (r.mu) {
          r.MU = decodeF32(r.mu);
          r.SD = decodeF32(r.sd);
        }
        r.fpos = {};
        r.feats.forEach((n, j) => {
          r.fpos[n] = j;
        });
      });
      m.maps = { arabidopsis: m.ag };
      Object.keys(m.routes).forEach((k) => {
        if (k === "og" || k === "arabidopsis") return;
        let mp = {};
        atlasState.idx.forEach((r) => {
          let ids = r[3] && r[3][k];
          if (!ids) return;
          let n = +r[0].slice(2);
          ids.forEach((g) => {
            mp[g.toUpperCase()] = n;
          });
        });
        m.maps[k] = mp;
      });
      CLF = m;
      return m;
    });
    return clfLoading;
  }
  function cleanGeneId(g) {
    return String(g || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .toUpperCase()
      .replace(/^GENE[-:]/, "");
  }
  function parseCountTable(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) return null;
    const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : /\s+/;
    const rows = lines.map(line => line.split(delimiter));
    const hasHeader = rows[0].slice(1).some(value => value.trim() !== "" && isNaN(+value));
    const defaultName = i => `sample ${i + 1}`;
    const width = Math.max(...rows.map(row => row.length - 1));
    const names = hasHeader ? rows.shift().slice(1).map((value, i) => value.trim().replace(/^["']|["']$/g, "") || defaultName(i))
      : Array.from({length: width}, (_, i) => defaultName(i));
    const genes = [], vals = [];
    for (const [gene, ...fields] of rows) {
      const counts = fields.slice(0, names.length).map(field => +String(field).trim());
      if (counts.length !== names.length || counts.some(value => !(value >= 0))) continue;
      genes.push(cleanGeneId(gene)); vals.push(counts);
    }
    return {names, genes, vals};
  }
  function geneToOg(route, g) {
    if (route === "og") return /^OG\d{7}$/.test(g) ? +g.slice(2) : null;
    let mp = CLF.maps[route],
      n = mp[g];
    if (n == null && route === "arabidopsis") n = mp[g.replace(/\.\d+$/, "")];
    return n == null ? null : n;
  }
  function mapCounts(table) {
    let route, hit = 0;
    for (const candidate of Object.keys(CLF.routes)) {
      const matches = table.genes.reduce((n, gene) => n + (geneToOg(candidate, gene) != null ? 1 : 0), 0);
      if (matches > hit) { route = candidate; hit = matches; }
    }
    if (!hit) return {error: "No gene ID matched Arabidopsis identifiers, the five crop genomes or RhizoAtlas orthogroups."};
    const model = CLF.routes[route];
    const seen = new Uint8Array(model.feats.length);
    const og = table.names.map(() => new Map());
    for (const [i, gene] of table.genes.entries()) {
      const group = geneToOg(route, gene);
      if (group == null) continue;
      const position = model.fpos[group];
      if (position != null) seen[position] = 1;
      for (const [s, sample] of og.entries()) sample.set(group, (sample.get(group) || 0) + table.vals[i][s]);
    }
    const tot = og.map(sample => Array.from(sample.values()).reduce((sum, count) => sum + count, 0));
    return {route, hit, total: table.genes.length, coverage: seen.reduce((a,b) => a+b,0) / model.feats.length, seen, og, tot, names: table.names};
  }
  function classifyMapped(mapped) {
    const model = CLF.routes[mapped.route], reliability = CLF.reliability || {};
    const width = model.feats.length, temperature = model.T || 1;
    function predict(name, sampleIndex) {
      const reads = mapped.tot[sampleIndex];
      if (!(reads > 0)) return {name, error: "no counts"};
      const counts = mapped.og[sampleIndex];
      const logits = model.b.slice();
      const stats = {distance: 0, size: 0, x: 0, u: 0, xx: 0, uu: 0, xu: 0};
      const features = model.feats.map((group, j) => {
        if (!mapped.seen[j] && model.MU) return model.MU[j];
        const expression = Math.log2((counts.get(group) || 0) / reads * 1e6 + 1);
        if (model.MU) {
          const mean = model.MU[j];
          stats.distance += Math.pow((expression - mean) / model.SD[j], 2);
          stats.size++; stats.x += expression; stats.u += mean;
          stats.xx += expression * expression; stats.uu += mean * mean; stats.xu += expression * mean;
        }
        return expression;
      });
      for (let category = 0; category < 4; category++) {
        for (let j = 0; j < width; j++) if (features[j] !== 0) logits[category] += model.W[category * width + j] * features[j];
      }
      const {distance, size, x, u, xx, uu, xu} = stats;
      const prof = size > 2 ? (xu - x*u/size) / Math.sqrt((xx-x*x/size)*(uu-u*u/size)) : null;
      const calibrated = logits.map(value => value / temperature);
      const maximum = Math.max(...calibrated);
      const weights = calibrated.map(value => Math.exp(value - maximum));
      const totalWeight = weights.reduce((a,b) => a+b,0);
      const p = weights.map(value => value / totalWeight);
      const warn = [];
      if (reliability.min_profile_r && prof != null && prof < reliability.min_profile_r) warn.push("profile does not look like raw gene counts: check gene IDs and values");
      else if (model.d_thr && size && distance/size > model.d_thr) warn.push("unusual expression profile");
      if (reliability.min_reads && reads < reliability.min_reads) warn.push(`low depth (${Math.round(reads).toLocaleString()} reads)`);
      if (reliability.min_coverage && mapped.coverage < reliability.min_coverage) warn.push("more than half of model genes missing");
      return {name, p, pred: p.indexOf(Math.max(...p)), reads, dist: size ? distance/size : null, prof, warn};
    }
    return mapped.names.map(predict);
  }
  function guessOrgan(name) {
    let n = name.toLowerCase();
    if (/rhizom/.test(n)) return "rhizome";
    if (/leaf|leaves|lamina|blade/.test(n)) return "leaf";
    if (/(^|[^a-z])root|roots/.test(n) && !/rootstock/.test(n)) return "root";
    if (/stem|culm|stalk/.test(n)) return "stem";
    return "";
  }
  /* matched-background residuals of one experiment, exactly as in the article (layers.py) */
  function qbin(rank, n) {
    let k = 0;
    for (let j = 1; j <= 9; j++) if (10 * (rank - 1) > (n - 1) * j) k++;
    return k;
  }
  function firstRanks(values) {
    const sorted = Array.from(values, (value, index) => ({value, index})).sort((a,b) => a.value-b.value);
    const ranks = new Array(values.length);
    for (const [i, record] of sorted.entries()) ranks[record.index] = i + 1;
    return ranks;
  }
  function experimentResiduals(mapped, organs) {
    const groups = [...new Set(mapped.og.flatMap(sample => [...sample.keys()]))].sort((a,b) => a-b);
    const samples = Object.fromEntries(ORG_KEYS.map(organ => [organ, []]));
    for (const [i, organ] of organs.entries()) if (samples[organ] && mapped.tot[i] > 0) samples[organ].push(i);
    const result = {n: Object.fromEntries(ORG_KEYS.map(organ => [organ, samples[organ].length])), res: {}};
    if (!samples.rhizome.length) return result;
    const meanExpression = ids => groups.map(group => ids.reduce((sum, i) => sum + Math.log2((mapped.og[i].get(group) || 0) / mapped.tot[i] * 1e6 + 1), 0) / ids.length);
    const target = meanExpression(samples.rhizome);
    const leaf = samples.leaf.length ? meanExpression(samples.leaf) : null;
    for (const comparison of ["root", "stem"]) {
      if (!samples[comparison].length) continue;
      const reference = meanExpression(samples[comparison]);
      const expressed = [];
      for (const [i, group] of groups.entries()) {
        const mean = (target[i] + reference[i]) / 2;
        if (mean > 0.5) expressed.push({group, mean, difference: target[i]-reference[i], depth: leaf ? reference[i]-leaf[i] : 0});
      }
      const n = expressed.length;
      if (n < 500) { result.res[comparison] = {error: "fewer than 500 expressed gene families"}; continue; }
      const ranks = firstRanks(expressed.map(row => row.mean));
      const depths = leaf ? firstRanks(expressed.map(row => row.depth)) : null;
      const strata = new Map();
      for (const [i, row] of expressed.entries()) {
        const level = qbin(ranks[i], n);
        row.cell = depths ? level*10 + qbin(depths[i], n) : level;
        if (!strata.has(row.cell)) strata.set(row.cell, {sum:0,count:0});
        const aggregate = strata.get(row.cell);
        aggregate.sum += row.difference; aggregate.count++;
      }
      const map = new Map(expressed.map(row => {
        const {sum,count} = strata.get(row.cell);
        return [row.group, row.difference - sum/count];
      }));
      result.res[comparison] = {map, n, leaf: !!leaf};
    }
    return result;
  }
  function spearman(x, y) {
    function rank(values) {
      const ordered = values.map((value, index) => ({value, index})).sort((a,b) => a.value-b.value);
      const result = new Array(values.length);
      for (let start = 0; start < ordered.length;) {
        let end = start + 1;
        while (end < ordered.length && ordered[end].value === ordered[start].value) end++;
        const average = (start + end - 1)/2 + 1;
        for (let i = start; i < end; i++) result[ordered[i].index] = average;
        start = end;
      }
      return result;
    }
    const left = rank(x), right = rank(y), center = (x.length + 1)/2;
    let cross = 0, varianceX = 0, varianceY = 0;
    for (let i = 0; i < x.length; i++) {
      const a = left[i] - center, b = right[i] - center;
      cross += a*b; varianceX += a*a; varianceY += b*b;
    }
    return cross / Math.sqrt(varianceX*varianceY);
  }
  let TRAIT_TESTS = [
    ["Class I KNOX", "root", "Stem-meristem identity (class I KNOX) vs root"],
    ["Starch synthesis", "root", "Starch synthesis vs root"],
    ["Class I KNOX", "stem", "Stem-meristem identity (class I KNOX) vs aerial stem"],
    ["Sugar import", "stem", "Sugar import vs aerial stem"],
    ["Soil interface", "stem", "Soil interface vs aerial stem"],
  ];
  function renderAnalyzeView() {
    if (anState.init) return;
    anState.init = true;
    elementById("an-splist").innerHTML = atlasState.meta.species
      .map((s) => {
        return '<option value="' + escapeMarkup(s.name) + '">';
      })
      .join("");
    elementById("an-run").addEventListener("click", runAnalyze);
    elementById("an-example").addEventListener("click", () => {
      elementById("an-msg").textContent = "Loading example…";
      fetch(dataRoot + "analyze_example.tsv")
        .then((r) => {
          return r.text();
        })
        .then((t) => {
          elementById("an-in").value = t;
          elementById("an-sp").value = (t.match(/^#\s*species:\s*(.+)$/m) || [])[1] || "";
          runAnalyze();
        });
    });
    elementById("an-file").addEventListener("change", (e) => {
      let f = e.target.files[0];
      if (!f) return;
      let rd = new FileReader();
      rd.onload = () => {
        elementById("an-in").value = rd.result;
        runAnalyze();
      };
      rd.readAsText(f);
    });
    elementById("an-sp").addEventListener("change", () => {
      if (anState.mp) renderReport();
    });
    elementById("an-fill").addEventListener("click", () => {
      if (!anState.cls) return;
      anState.cls.forEach((c, s) => {
        if (!anState.organs[s] && c.p) anState.organs[s] = ORG_KEYS[c.pred];
      });
      renderSampleTable();
      renderReport();
    });
    elementById("an-dl1").addEventListener("click", () => {
      let lines = [["sample", "assigned_organ", "P_rhizome", "P_aerial_stem", "P_root", "P_leaf", "predicted", "label_check", "reads", "warnings"].join(",")];
      anState.cls.forEach((c, s) => {
        lines.push(
          [c.name, anState.organs[s] || ""]
            .concat(c.p ? c.p.map((v) => v.toFixed(4)) : ["", "", "", ""])
            .concat([c.p ? ORGAN_CLASSES[c.pred][1] : c.error, labelCheck(c, anState.organs[s]) || "", c.reads, (c.warn || []).join("; ")])
            .map(csvCell)
            .join(","),
        );
      });
      downloadText("rhizoatlas_samples.csv", lines.join("\n"));
    });
    elementById("an-dl2").addEventListener("click", downloadExperimentGenes);
  }
  function labelCheck(c, organ) {
    let k = ORG_KEYS.indexOf(organ);
    if (!c.p || k < 0) return null;
    if (c.p[k] < 0.1 && Math.max.apply(null, c.p) >= 0.8) return "check label";
    return c.pred === k ? "consistent" : "uncertain";
  }
  function runAnalyze() {
    let msg = elementById("an-msg"),
      text = elementById("an-in").value.replace(/^#.*$/gm, ""),
      tab = parseCountTable(text);
    if (!tab || !tab.genes.length) {
      msg.textContent = "Paste a count table first: gene IDs in the first column, one sample per further column.";
      elementById("an-samples").hidden = true;
      elementById("an-report").hidden = true;
      return;
    }
    msg.textContent = "Loading the model and atlas data…";
    Promise.all([loadClassifier(), loadResiduals()])
      .then(() => {
        let mp = mapCounts(tab);
        if (mp.error) {
          msg.textContent = mp.error;
          elementById("an-samples").hidden = true;
          elementById("an-report").hidden = true;
          return;
        }
        anState.mp = mp;
        anState.cls = classifyMapped(mp);
        anState.organs = tab.names.map(guessOrgan);
        msg.innerHTML =
          tab.names.length +
          " sample" +
          (tab.names.length === 1 ? "" : "s") +
          " · detected <b>" +
          ROUTE_LABEL[mp.route] +
          "</b>: " +
          mp.hit.toLocaleString() +
          " of " +
          mp.total.toLocaleString() +
          " genes matched, " +
          Math.round(100 * mp.coverage) +
          "% of model genes present" +
          (CLF.reliability && mp.coverage < CLF.reliability.min_coverage ? ' · <span class="flag">include all genes, with zeros, for reliable results</span>' : "");
        let V = CLF.validation && CLF.validation[mp.route],
          C = CLF.calibration && CLF.calibration[mp.route];
        elementById("an-valid").textContent = V
          ? "Validated for this input type by leaving out each species in turn: balanced accuracy " +
            V.loso.toFixed(2) +
            " (chance 0.25); across lineages " +
            Math.min(V.m2o, V.o2m).toFixed(2) +
            "–" +
            Math.max(V.m2o, V.o2m).toFixed(2) +
            "." +
            (C ? " Probabilities are temperature-calibrated (expected calibration error " + C.ece_raw.toFixed(3) + " before, " + C.ece_cv.toFixed(3) + " after)." : "") +
            (CLF.reliability
              ? " Genes missing from your table are scored at the atlas mean, which keeps accuracy at 0.80 or above with up to half of the model genes missing. Warnings flag fewer than " +
                CLF.reliability.min_reads.toLocaleString() +
                " reads (accuracy is stable down to this depth), fewer than " +
                Math.round(100 * CLF.reliability.min_coverage) +
                "% of model genes, a profile unlike any training sample, or values that do not behave like gene counts (for example, mismatched gene IDs)."
              : "")
          : "";
        renderSampleTable();
        renderReport();
        elementById("an-samples").hidden = false;
      })
      .catch((e) => {
        msg.textContent = "The model could not be loaded (" + e.message + ").";
      });
  }
  function renderSampleTable() {
    let opts = [
      ["", "not used"],
      ["rhizome", "Rhizome"],
      ["stem", "Aerial stem"],
      ["root", "Root"],
      ["leaf", "Leaf"],
    ];
    elementById("an-table").innerHTML =
      "<thead><tr><th>Sample</th><th>Organ</th><th>Predicted organ</th><th>Notes</th></tr></thead><tbody>" +
      anState.cls
        .map((c, s) => {
          if (!c.p) return '<tr><td class="mono small">' + escapeMarkup(c.name) + '</td><td colspan="3" class="muted">' + c.error + "</td></tr>";
          let chk = labelCheck(c, anState.organs[s]),
            notes = (chk === "check label" ? ['<span class="flag">⚑ check label</span>'] : []).concat(
              c.warn.map((w) => {
                return '<span class="warn">⚠ ' + escapeMarkup(w) + "</span>";
              }),
            );
          return (
            '<tr><td class="mono small">' +
            escapeMarkup(c.name) +
            '</td><td><select class="sel small-sel" data-s="' +
            s +
            '">' +
            opts
              .map((o) => {
                return '<option value="' + o[0] + '"' + (anState.organs[s] === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
              })
              .join("") +
            "</select></td><td>" +
            probabilityBar(
              c.p,
              ORGAN_CLASSES.map((x, k) => {
                return x[1] + " " + c.p[k].toFixed(2);
              }).join(" · "),
            ) +
            " <b>" +
            ORGAN_CLASSES[c.pred][1] +
            '</b> <span class="muted small">' +
            Math.round(100 * c.p[c.pred]) +
            "%</span></td>" +
            '<td class="small">' +
            (notes.length ? notes.join("<br>") : '<span class="muted">' + (chk || "–") + "</span>") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody>";
    elementById("an-table")
      .querySelectorAll("select[data-s]")
      .forEach((sel) => {
        sel.addEventListener("change", () => {
          anState.organs[+sel.dataset.s] = sel.value;
          renderSampleTable();
          renderReport();
        });
      });
  }
  function atlasConsensus(comparison, excludedSpecies) {
    const block = RES.comp[comparison], excluded = excludedSpecies == null ? -1 : excludedSpecies;
    block.consCache ||= {};
    if (block.consCache[excluded]) return block.consCache[excluded];
    const width = RES.nO, matrix = speciesMedians(comparison);
    const offsets = block.spList.flatMap((species,i) => species === excluded ? [] : [i*width]);
    const consensus = Float32Array.from({length: width}, (_, column) => {
      const values = offsets.map(offset => matrix[offset + column]).filter(value => !Number.isNaN(value));
      return values.length >= 5 ? medianOf(values) : NaN;
    });
    return block.consCache[excluded] = consensus;
  }
  function renderReport() {
    let ex = experimentResiduals(anState.mp, anState.organs),
      box = elementById("an-report");
    anState.report = ex;
    let comps = ["root", "stem"].filter((c) => {
      return ex.res[c] && ex.res[c].map;
    });
    if (!comps.length) {
      box.hidden = false;
      elementById("an-design").innerHTML =
        "Assign at least one sample to <b>Rhizome</b> and one to <b>Root</b> or <b>Aerial stem</b> to profile the experiment" +
        (["root", "stem"].some((c) => {
          return ex.res[c] && ex.res[c].error;
        })
          ? " (too few expressed gene families)."
          : ".");
      ["an-traits", "an-facts"].forEach((id) => {
        elementById(id).innerHTML = "";
      });
      elementById("an-dl2").hidden = true;
      return;
    }
    elementById("an-dl2").hidden = false;
    let own = elementById("an-sp").value.trim(),
      ownIdx = RES.species.indexOf(own),
      L = atlasState.layers;
    elementById("an-design").innerHTML =
      "Rhizome (" +
      ex.n.rhizome +
      ") compared with " +
      comps
        .map((c) => {
          return (c === "root" ? "root (" : "aerial stem (") + ex.n[c] + ")";
        })
        .join(" and ") +
      (ex.n.leaf ? "; leaves (" + ex.n.leaf + ") used to match background genes" : "; no leaf samples, so background genes are matched for expression only") +
      ". Grey dots: atlas species" + (ownIdx >= 0 ? " (your species excluded)" : "") + "; orange: your experiment.";
    let traitsHtml = TRAIT_TESTS.filter((t) => {
      return comps.indexOf(t[1]) >= 0;
    })
      .map((t) => {
        let mem = L.sets[t[0]]
            .map((o) => {
              return +o.slice(2);
            })
            .filter((n) => {
              return ex.res[t[1]].map.has(n);
            }),
          v = mem.length
            ? mem.reduce((a, n) => {
                return a + ex.res[t[1]].map.get(n);
              }, 0) / mem.length
            : NaN;
        let sc = scoreGeneSet(L.sets[t[0]])[t[1]],
          atlas = Object.keys(sc.sp)
            .map((k) => {
              return [+k, sc.sp[k]];
            })
            .filter((x) => {
              return x[1] === x[1] && x[0] !== ownIdx;
            });
        let below = atlas.filter((x) => {
          return x[1] < v;
        }).length;
        return (
          '<div class="trow"><div class="tlab">' +
          escapeMarkup(t[2]) +
          '</div><div class="tplot">' +
          stripPlot(
            atlas.map((x) => {
              return x[1];
            }),
            v,
            atlas.map((x) => {
              return RES.species[x[0]];
            }),
          ) +
          '</div><div class="tval">' +
          (v === v ? "<b>" + fmt2(v) + "</b> · higher than " + below + " of " + atlas.length + " species" : '<span class="muted">genes not expressed</span>') +
          "</div></div>"
        );
      })
      .join("");
    elementById("an-traits").innerHTML = traitsHtml;
    let ref = CLF.experiment_ref && (CLF.experiment_ref[anState.mp.route] || CLF.experiment_ref.arabidopsis),
      core = atlasState.clf.core.map((c) => {
        return +c.og.slice(2);
      });
    let facts = comps.map((c) => {
      let m = ex.res[c].map,
        cons = atlasConsensus(c, ownIdx >= 0 ? ownIdx : null),
        x = [],
        y = [];
      m.forEach((v, n) => {
        let j = RES.col[ogName(n)];
        if (j != null && cons[j] === cons[j]) {
          x.push(v);
          y.push(cons[j]);
        }
      });
      let rho = spearman(x, y),
        kc = core.filter((n) => {
          return m.has(n) && m.get(n) > 0;
        }).length,
        nc = core.filter((n) => {
          return m.has(n);
        }).length;
      let S = speciesMedians(c),
        C = RES.comp[c],
        nO = RES.nO,
        sims = [];
      C.spList.forEach((s, si) => {
        if (s === ownIdx) return;
        let a = [],
          b = [];
        m.forEach((v, n) => {
          let j = RES.col[ogName(n)];
          if (j == null) return;
          let w = S[si * nO + j];
          if (w === w) {
            a.push(v);
            b.push(w);
          }
        });
        if (a.length >= 500) sims.push([s, spearman(a, b)]);
      });
      sims.sort((p, q) => {
        return q[1] - p[1];
      });
      let R = ref && ref[c],
        lab = c === "root" ? "Rhizome vs root" : "Rhizome vs aerial stem",
        word = !R
          ? "ρ = " + rho.toFixed(2)
          : rho < R.rho[0]
            ? "much weaker than in atlas studies"
            : rho < R.rho[1]
              ? "weaker than most atlas studies"
              : rho <= R.rho[3]
                ? "typical of atlas studies"
                : rho <= R.rho[4]
                  ? "stronger than most atlas studies"
                  : "stronger than almost all atlas studies";
      return {
        line:
          '<div class="tk"><span class="k">' +
          lab +
          "</span><span>Agreement with the cross-species rhizome signature: <b>" +
          word +
          "</b> · <b>" +
          kc +
          " of " +
          nc +
          "</b> core rhizome genes higher · most similar: <i>" +
          (sims.length ? escapeMarkup(RES.species[sims[0][0]]) : "–") +
          "</i></span></div>",
        row:
          "<tr><td>" +
          lab +
          '</td><td class="num">' +
          rho.toFixed(2) +
          '</td><td class="num">' +
          (R ? R.rho[2].toFixed(2) + " (" + R.rho[0].toFixed(2) + " to " + R.rho[4].toFixed(2) + ")" : "–") +
          '</td><td class="num">' +
          kc +
          " of " +
          nc +
          (R ? " (atlas median " + R.core[1] + ")" : "") +
          "</td><td>" +
          sims
            .slice(0, 3)
            .map((p) => {
              return "<i>" + escapeMarkup(RES.species[p[0]]) + "</i> (" + p[1].toFixed(2) + ")";
            })
            .join(", ") +
          "</td></tr>",
      };
    });
    elementById("an-facts").innerHTML = facts
      .map((f) => {
        return f.line;
      })
      .join("");
    elementById("an-numbers").innerHTML =
      '<thead><tr><th>Comparison</th><th class="num">Signature agreement (<span style="text-transform:none">ρ</span>)</th><th class="num">Atlas studies: median (90% range)</th><th class="num">Core genes higher</th><th>Most similar atlas species (<span style="text-transform:none">ρ</span>)</th></tr></thead><tbody>' +
      facts
        .map((f) => {
          return f.row;
        })
        .join("") +
      "</tbody>";
    let V = CLF.experiment_validation || {};
    elementById("an-method").innerHTML =
      "For each comparison, the rhizome-minus-comparator difference in log2(CPM + 1) of every gene family expressed above 0.5 is corrected by the mean difference of gene families in the same cell of a 10 × 10 grid of expression level and comparator-minus-leaf difference (expression level only without leaves), exactly as for the article's trait indices; a trait score is the mean corrected difference of its gene families. The signature agreement is the Spearman correlation between your corrected differences and the median across atlas species" + (own && ownIdx >= 0 ? " other than yours" : "") + "; similar species are ranked by the same correlation" +
      (own && ownIdx >= 0 ? " (your species is excluded)" : "") +
      "." +
      (V.text ? " " + V.text : "");
    box.hidden = false;
  }
  function stripPlot(vals, v, names) {
    let all = vals.concat(v === v ? [v] : []),
      lim = Math.max(1, Math.ceil(Math.max.apply(null, all.map(Math.abs)) * 2) / 2),
      W = 320,
      H = 30,
      sx = (x) => {
        return 10 + ((x + lim) / (2 * lim)) * (W - 20);
      };
    let o = ['<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" style="max-width:100%;height:auto" role="img" aria-label="Your score among atlas species">'];
    o.push('<line x1="' + sx(0) + '" x2="' + sx(0) + '" y1="2" y2="' + (H - 2) + '" stroke="var(--line2)" stroke-width="1"></line>');
    vals.forEach((x, i) => {
      let jy = 8 + ((i * 7919) % 15);
      o.push('<circle cx="' + sx(x).toFixed(1) + '" cy="' + jy + '" r="2.6" fill="var(--muted)" opacity="0.45"><title>' + escapeMarkup(names[i]) + ": " + fmt2(x) + "</title></circle>");
    });
    if (v === v) {
      let x = sx(v);
      o.push('<path d="M' + x + " 4 L" + (x + 6) + " 15 L" + x + " 26 L" + (x - 6) + ' 15 Z" fill="var(--o-rhizome)" stroke="var(--surface)" stroke-width="1.5"></path>');
    }
    o.push('<text x="10" y="' + (H - 1) + '" font-size="8" fill="var(--muted)">−' + lim + '</text><text x="' + (W - 10) + '" y="' + (H - 1) + '" font-size="8" fill="var(--muted)" text-anchor="end">+' + lim + "</text>");
    o.push("</svg>");
    return o.join("");
  }
  function downloadExperimentGenes() {
    let ex = anState.report;
    if (!ex) return;
    let comps = ["root", "stem"].filter((c) => {
      return ex.res[c] && ex.res[c].map;
    });
    let cons = {};
    comps.forEach((c) => {
      let own = RES.species.indexOf(elementById("an-sp").value.trim());
      cons[c] = atlasConsensus(c, own >= 0 ? own : null);
    });
    let ogs = new Set();
    comps.forEach((c) => {
      ex.res[c].map.forEach((_, n) => {
        ogs.add(n);
      });
    });
    let rows = Array.from(ogs).map((n) => {
      let og = ogName(n),
        i = atlasState.byId[og],
        x = i == null ? null : atlasState.idx[i],
        j = RES.col[og];
      let rec = [
        og,
        x
          ? x[1]
              .map((m) => {
                return m[1];
              })
              .filter((s) => {
                return s;
              })
              .join(";")
          : "",
        x && x[1][0] ? x[1][0][2] : "",
      ];
      comps.forEach((c) => {
        let v = ex.res[c].map.get(n);
        rec.push(v == null ? "" : v.toFixed(3), j == null || cons[c][j] !== cons[c][j] ? "" : cons[c][j].toFixed(3));
      });
      return rec;
    });
    rows.sort((a, b) => {
      return (+b[3] || -99) - (+a[3] || -99);
    });
    let head = ["orthogroup", "arabidopsis_symbols", "description"];
    comps.forEach((c) => {
      head.push("your_residual_vs_" + c, "atlas_median_residual_vs_" + c);
    });
    downloadText("rhizoatlas_experiment_genes.csv", [head.join(",")].concat(rows.map((r) => r.map(csvCell).join(","))).join("\n"));
  }
  function routeFromHash() {
    let h = decodeURIComponent((location.hash || "").replace("#", ""));
    if (h.indexOf("gene/") === 0 && h.length > 5) {
      showView("gene");
      searchAndDisplay(h.slice(5));
      return;
    }
    if (h === "gene" && atlasState.og != null) return showView("gene");
    if (h === "layers" || h === "traits") h = "score";
    if (h === "classify") h = "analyze";
    showView(VIEWS.indexOf(h) >= 0 && h !== "gene" ? h : "home");
  }
  readColorScales();
  let mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function refreshColorTheme() {
    readColorScales();
    if (atlasState.og != null && !elementById("view-gene").hidden) renderExpressionView();
    if (!elementById("view-score").hidden && scoreState.last) drawScoreHeatmap(scoreState.last);
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", refreshColorTheme);
  Promise.all([
    fetchDataset("meta.json"),
    fetchDataset("og_index.json"),
    fetchDataset("layers.json"),
    fetchDataset("runs.json"),
    fetchDataset("crops.json").catch(() => {
      return {};
    }),
    fetchDataset("aliases.json").catch(() => {
      return {};
    }),
    fetchDataset("classifier.json").catch(() => {
      return null;
    }),
    fetchDataset("screen.json").catch(() => {
      return null;
    }),
  ])
    .then((r) => {
      atlasState.meta = r[0];
      atlasState.idx = r[1];
      atlasState.layers = r[2];
      atlasState.runs = r[3];
      atlasState.crops = r[4];
      atlasState.clf = r[6];
      atlasState.screen = r[7];
      elementById("samples-legend").innerHTML = organLegend() + '<span><span class="flag">⚑</span> label may need checking</span>';
      let mm = atlasState.meta;
      elementById("h-sp").textContent = mm.species.length;
      elementById("foot").innerHTML =
        '<a href="#about">About and methods</a> · ' + mm.n_runs.toLocaleString() + " samples · " + mm.species.length + " species · data version " + escapeMarkup(mm.version) + " · CC BY 4.0";
      buildSearchIndex();
      registerAliases(r[5]);
      buildSuggestIndex(r[5]);
      let ex = [
        ["STM", "STM"],
        ["KNAT1", "KNAT1"],
        ["SUS1", "SUS1"],
        ["ADH1", "ADH1"],
        ["CYP86B1", "CYP86B1"],
        ["AHB1", "AHB1"],
      ].filter((e) => {
        return findOrthogroups(e[1]).length === 1;
      });
      elementById("examples").innerHTML =
        "Try" +
        ex
          .map((e) => {
            return (
              ' <button type="button" class="chip" data-q="' + e[1] + '">' + e[0] + "</button>"
            );
          })
          .join("");
      elementById("examples")
        .querySelectorAll("button")
        .forEach((b) => {
          b.addEventListener("click", () => {
            doSearch(b.dataset.q);
          });
        });
      atlasState.meta.organs.forEach((g) => {
        let o = document.createElement("option");
        o.value = g[0];
        o.textContent = g[1];
        elementById("so").appendChild(o);
      });
      routeFromHash();
      atlasState.ready = true;
      window.addEventListener("hashchange", () => {
        routeFromHash();
      });
    })
    .catch((e) => {
      elementById("result").innerHTML =
        '<span class="status">The atlas data could not be loaded (' +
        escapeMarkup(e.message) +
        "). Reload the page to try again.</span>";
    });
})();
