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
    chunk: {},
    og: null,
    filter: "all",
    mode: "chart",
  };
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
  function showView(v) {
    ["gene", "layers", "samples", "about"].forEach((k) => {
      elementById("view-" + k).hidden = k !== v;
      elementById("tab-" + k).setAttribute("aria-selected", k === v ? "true" : "false");
    });
    if (v === "layers") renderLayerView();
    if (v === "samples") renderSampleRows(true);
    if (v === "about") renderAboutSection();
  }
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      showView(b.dataset.view);
    });
  });
  function normalizeUppercase(s) {
    return String(s || "")
      .trim()
      .toUpperCase();
  }
  function normalizeSymbol(s) {
    return normalizeUppercase(s).replace(/\.\d+$/, "");
  }
  function buildSearchIndex() {
    atlasState.idx.forEach((r, i) => {
      let og = r[0];
      atlasState.byId[og] = i;
      add(og, i);
      r[1].forEach((m) => {
        add(m[0], i);
        if (m[1]) add(m[1], i);
      });
      let c = r[3] || {};
      Object.keys(c).forEach((k) => {
        c[k].forEach((g) => {
          add(g, i);
        });
      });
    });
    function add(k, i) {
      k = normalizeUppercase(k);
      if (!k) return;
      indexUniqueValue(k, i);
      if (normalizeSymbol(k) !== k) indexUniqueValue(normalizeSymbol(k), i);
    }
  }
  function indexUniqueValue(k, i, T) {
    T = T || atlasState.lookup;
    (T[k] = T[k] || []).indexOf(i) < 0 && T[k].push(i);
  }
  function registerAliases(A) {
    Object.keys(A).forEach((k) => {
      A[k].forEach((og) => {
        let i = atlasState.byId[og];
        if (i != null) indexUniqueValue(k, i, atlasState.alias);
      });
    });
  }
  function findOrthogroups(q) {
    let k = normalizeSymbol(q),
      u = normalizeUppercase(q);
    if (!k) return [];
    if (atlasState.lookup[u]) return atlasState.lookup[u];
    if (atlasState.lookup[k]) return atlasState.lookup[k];
    if (atlasState.alias[u]) return atlasState.alias[u];
    if (atlasState.alias[k]) return atlasState.alias[k];
    let out = [];
    for (let i = 0; i < atlasState.idx.length && out.length < 25; i++) {
      let r = atlasState.idx[i],
        hit = r[0].toUpperCase().indexOf(k) === 0;
      if (!hit)
        hit = r[1].some((m) => {
          return (
            (m[1] && m[1].toUpperCase().indexOf(k) === 0) ||
            (k.length > 3 && m[2] && m[2].toUpperCase().indexOf(k) >= 0)
          );
        });
      if (hit) out.push(i);
    }
    return out;
  }
  elementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    searchAndDisplay(elementById("q").value);
  });
  function searchAndDisplay(q) {
    let hits = findOrthogroups(q);
    if (!hits.length) {
      elementById("result").innerHTML =
        '<span class="status">No orthogroup matches “' +
        escapeMarkup(q) +
        "”. Try an Arabidopsis identifier such as AT1G62360, a symbol such as STM, or an orthogroup identifier.</span>";
      return;
    }
    if (hits.length === 1) return selectOrthogroup(hits[0]);
    elementById("result").innerHTML =
      '<span class="status">' +
      hits.length +
      (hits.length >= 25 ? "+" : "") +
      " orthogroups match “" +
      escapeMarkup(q) +
      '”. Pick one:</span><div class="matches">' +
      hits
        .map((i) => {
          let r = atlasState.idx[i];
          return (
            '<button type="button" data-i="' +
            i +
            '"><span class="mono">' +
            escapeMarkup(r[0]) +
            "</span> · " +
            escapeMarkup(
              r[1]
                .slice(0, 4)
                .map((m) => {
                  return m[1] || m[0];
                })
                .join(", "),
            ) +
            '<span class="muted"> ' +
            escapeMarkup((r[1][0] || [])[2] || "") +
            "</span></button>"
          );
        })
        .join("") +
      "</div>";
    elementById("result")
      .querySelectorAll(".matches button")
      .forEach((b) => {
        b.addEventListener("click", () => {
          selectOrthogroup(+b.dataset.i);
        });
      });
  }
  function selectOrthogroup(i) {
    atlasState.og = i;
    let r = atlasState.idx[i];
    let crops = r[3] || {},
      ck = Object.keys(crops);
    elementById("result").innerHTML =
      '<div class="og-head"><span class="id">' +
      escapeMarkup(r[0]) +
      '</span><span class="muted">' +
      r[2] +
      " Arabidopsis " +
      (r[2] === 1 ? "gene" : "genes") +
      "</span></div>" +
      '<div class="members">' +
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
      (r[2] > r[1].length ? '<span class="muted">+' + (r[2] - r[1].length) + " more</span>" : "") +
      "</div>" +
      (r[1][0] && r[1][0][2] ? '<p class="muted">' + escapeMarkup(r[1][0][2]) + "</p>" : "") +
      (ck.length
        ? '<div class="crops">' +
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
          "</div>"
        : "");
    fetchExpressionChunk(Math.floor(i / atlasState.meta.chunk))
      .then(renderExpressionView)
      .catch((e) => {
        elementById("matrix-box").innerHTML =
          '<p class="status" style="padding:12px">Expression values could not be loaded (' +
          escapeMarkup(e.message) +
          ").</p>";
      });
  }
  function fetchExpressionChunk(c) {
    if (atlasState.chunk[c]) return Promise.resolve(atlasState.chunk[c]);
    let name = ("00" + c).slice(-3) + ".json";
    return fetchDataset("expr/" + name).then((d) => {
      let b = atob(d.v),
        n = b.length >> 1,
        a = new Uint16Array(n);
      for (let k = 0; k < n; k++) a[k] = b.charCodeAt(2 * k) | (b.charCodeAt(2 * k + 1) << 8);
      atlasState.chunk[c] = { start: d.start, v: a };
      return atlasState.chunk[c];
    });
  }
  function getExpressionValues(i) {
    let c = atlasState.chunk[Math.floor(i / atlasState.meta.chunk)],
      nu = atlasState.meta.units.length,
      off = (i - c.start) * nu,
      out = new Array(nu);
    for (let u = 0; u < nu; u++) out[u] = c.v[off + u] / atlasState.meta.scale;
    return out;
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
    let treeW = 130,
      nameW = 214,
      hdrH = 136,
      padR = 110;
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
      '<span class="bar"><span class="na"></span>not sampled</span>';
  }
  function renderLayerView() {
    let L = atlasState.layers;
    if (!L) return;
    elementById("tests").innerHTML =
      '<thead><tr><th>Comparison</th><th class="num">Species higher in rhizome</th><th class="num">Sign test P</th><th class="num">Phylogenetic <span style="text-transform:none">λ</span></th><th class="num">PGLS P</th></tr></thead><tbody>' +
      L.tests
        .map((t) => {
          return (
            "<tr><td>" +
            escapeMarkup(t.label) +
            '</td><td class="num">' +
            (t.higher == null ? "–" : t.higher + " / " + t.n) +
            '</td><td class="num">' +
            formatPValue(t.p_sign) +
            '</td><td class="num">' +
            (t.lam == null ? "–" : t.lam.toFixed(2)) +
            '</td><td class="num">' +
            formatPValue(t.p_pgls) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody>";
    let layerColorMax = 1.5;
    elementById("legend2").innerHTML =
      '<span class="bar">−' +
      layerColorMax +
      '<span class="grad" style="background:' +
      gradientBackground(colorScales.div) +
      '"></span>+' +
      layerColorMax +
      ' <span>layer score, log2 units beyond matched background</span></span><span class="bar"><span class="na"></span>comparison not available</span>';
    let lay = L.layout,
      sp = lay.order,
      cols = L.columns,
      treeW = 130,
      nameW = 214,
      hdrH = 176,
      x0 = treeW + nameW,
      W = x0 + cols.length * columnWidth + 110,
      H = hdrH + sp.length * rowHeight + 14;
    let info = {};
    atlasState.meta.species.forEach((s) => {
      info[s.name] = s;
    });
    let o = [
      '<svg id="lx" width="' +
        W +
        '" height="' +
        H +
        '" viewBox="0 0 ' +
        W +
        " " +
        H +
        '" role="img" aria-label="Layer scores by species"><defs><pattern id="hatch2" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--surface)"></rect><line x1="0" y1="0" x2="0" y2="4" stroke="var(--line)" stroke-width="1" opacity="0.7"></line></pattern></defs>',
    ];
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
    cols.forEach((c, k) => {
      o.push(
        '<text class="hdr" transform="translate(' +
          (x0 + k * columnWidth + columnWidth / 2) +
          "," +
          (hdrH - 8) +
          ') rotate(-55)">' +
          escapeMarkup(c) +
          "</text>",
      );
    });
    renderLineageMarkers(o, sp, info, hdrH, x0 + cols.length * columnWidth + 8, treeW);
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
      (L.scores[s] || []).forEach((v, k) => {
        o.push(
          '<rect x="' +
            (x0 + k * columnWidth + 1) +
            '" y="' +
            (y + 1) +
            '" width="' +
            (columnWidth - 2) +
            '" height="' +
            (rowHeight - 2) +
            '" rx="1.5" fill="' +
            (v == null ? "url(#hatch2)" : contrastFill(v, layerColorMax)) +
            '" data-s="' +
            r +
            '" data-k="' +
            k +
            '"></rect>',
        );
      });
    });
    o.push("</svg>");
    elementById("layers-box").innerHTML = o.join("");
    let tip = elementById("tip"),
      svg = elementById("lx");
    svg.addEventListener("mousemove", (e) => {
      let t = e.target;
      if (t.tagName !== "rect" || t.dataset.s == null) {
        tip.hidden = true;
        return;
      }
      let s = sp[+t.dataset.s],
        k = +t.dataset.k,
        v = (L.scores[s] || [])[k];
      tip.innerHTML =
        "<i>" +
        escapeMarkup(s) +
        "</i><br>" +
        escapeMarkup(cols[k]) +
        ": " +
        (v == null
          ? '<span class="muted">comparison not available</span>'
          : "<b>" + (v >= 0 ? "+" : "") + v.toFixed(2) + "</b>");
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    svg.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
    elementById("sets").innerHTML = Object.keys(L.sets)
      .map((k) => {
        let v = L.sets[k];
        return (
          '<div class="card"><h3>' +
          escapeMarkup(k) +
          ' <span class="pill">' +
          v.length +
          ' orthogroups</span></h3><div class="members">' +
          v
            .map((og) => {
              let i = atlasState.byId[og],
                r = atlasState.idx[i],
                lab = r
                  ? r[1]
                      .slice(0, 2)
                      .map((m) => {
                        return m[1] || m[0];
                      })
                      .join(", ") || og
                  : og;
              return (
                '<button type="button" class="member" data-og="' +
                escapeMarkup(og) +
                '" title="' +
                escapeMarkup(og) +
                '">' +
                escapeMarkup(lab) +
                "</button>"
              );
            })
            .join("") +
          "</div></div>"
        );
      })
      .join("");
    elementById("sets")
      .querySelectorAll("button[data-og]")
      .forEach((b) => {
        b.addEventListener("click", () => {
          let i = atlasState.byId[b.dataset.og];
          if (i == null) return;
          showView("gene");
          elementById("q").value = atlasState.idx[i][0];
          selectOrthogroup(i);
          window.scrollTo(0, 0);
        });
      });
  }
  let shown = 0,
    samplePageSize = 200,
    filtered = [];
  function renderSampleRows(reset) {
    if (!atlasState.runs) return;
    if (reset) {
      let q = elementById("sq").value.trim().toLowerCase(),
        og = elementById("so").value;
      filtered = atlasState.runs.filter((r) => {
        return (
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
          "</td></tr>"
        );
      })
      .join("");
    if (reset)
      elementById("runs").innerHTML =
        '<thead><tr><th>Run</th><th>Species</th><th>Organ</th><th>Study</th><th class="num">Assigned reads</th></tr></thead><tbody>' +
        rows +
        "</tbody>";
    else elementById("runs").querySelector("tbody").insertAdjacentHTML("beforeend", rows);
    elementById("more").hidden = shown >= filtered.length;
    elementById("samples-sum").textContent =
      filtered.length.toLocaleString() +
      " of " +
      atlasState.runs.length.toLocaleString() +
      " samples shown below as filtered. Every sample passed quality control and was quantified the same way.";
  }
  elementById("sq").addEventListener("input", () => {
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
      " species. It covers rhizomes, aerial stems, roots and leaves, and other storage organs such as tubers, storage roots, corms and bulbs. Every sample was quantified the same way, so values can be compared across species.</p>" +
      "<h3>How values were obtained</h3><ul>" +
      "<li>Organ labels were curated from the public sample and study records, and samples that failed quality control or curation were removed.</li>" +
      "<li>For each sample, reads were assigned to proteins of annotated plant genomes and counted per orthogroup.</li>" +
      "<li>Values are log2(counts per million + 1), averaged over the samples of a species and organ.</li>" +
      "<li>The rhizome-minus-comparator columns are simple differences of these species means. The layer scores in the Three layers view use a matched background instead.</li>" +
      "<li>Species are ordered by the species tree: " +
      escapeMarkup(m.tree_source) +
      ".</li></ul>" +
      "<h3>Data and citation</h3><p>The complete count matrices, sample metadata, gene sets and layer scores are deposited at Zenodo; the DOI is given in the accompanying article.</p>" +
      '<p class="muted">Data version ' +
      escapeMarkup(m.version) +
      ". License: CC BY 4.0.</p>";
  }
  readColorScales();
  let mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function refreshColorTheme() {
    readColorScales();
    if (atlasState.og != null && !elementById("view-gene").hidden) renderExpressionView();
    if (!elementById("view-layers").hidden) renderLayerView();
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
  ])
    .then((r) => {
      atlasState.meta = r[0];
      atlasState.idx = r[1];
      atlasState.layers = r[2];
      atlasState.runs = r[3];
      atlasState.crops = r[4];
      buildSearchIndex();
      registerAliases(r[5]);
      let ex = [
        ["KNAT6", "KNAT6"],
        ["STM", "STM"],
        ["KNAT1", "KNAT1"],
        ["SUS1", "SUS1"],
        ["GPT1", "AT5G54800"],
        ["CYP86B1", "CYP86B1"],
        ["AHB1", "AHB1"],
        ["MIOX1", "MIOX1"],
      ].filter((e) => {
        return findOrthogroups(e[1]).length === 1;
      });
      elementById("examples").innerHTML =
        "Try:" +
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
            elementById("q").value = b.dataset.q;
            searchAndDisplay(b.dataset.q);
          });
        });
      atlasState.meta.organs.forEach((g) => {
        let o = document.createElement("option");
        o.value = g[0];
        o.textContent = g[1];
        elementById("so").appendChild(o);
      });
      elementById("q").value = "STM";
      searchAndDisplay("STM");
      let h = (location.hash || "").replace("#", "");
      if (["gene", "layers", "samples", "about"].indexOf(h) >= 0) showView(h);
    })
    .catch((e) => {
      elementById("result").innerHTML =
        '<span class="status">The atlas data could not be loaded (' +
        escapeMarkup(e.message) +
        "). Reload the page to try again.</span>";
    });
})();
