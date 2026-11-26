#!/usr/bin/env python3
"""RhizoAtlas command-line tools. Same data files and same computations as the RhizoAtlas website.

Requires only Python 3.8+ (standard library). Data are read from a local copy of the website's data/ folder
(default: ./data next to this script) or from a URL given with --data (the website address followed by /data/).

  python3 rhizoatlas.py classify  counts.tsv [--expected rhizome|stem|root|leaf]
  python3 rhizoatlas.py analyze   counts.tsv [--organs organs.tsv] [--species "Zingiber officinale"] [--genes genes.tsv]
  python3 rhizoatlas.py score     genes.txt
  python3 rhizoatlas.py candidates [--compare both|root|stem] [--direction up|down] [--group all|monocots|eudicots]
                                   [--fdr 0.05]

counts.tsv: raw read counts per gene (not TPM/FPKM); gene IDs in the first column (Arabidopsis identifiers, RefSeq
gene IDs from the ginger, turmeric, lotus, Coptis or banana genome, or RhizoAtlas orthogroups), one sample per further
column, sample names in the first row. organs.tsv: two columns, sample name and organ (rhizome, stem, root, leaf);
without it, organs are guessed from sample names. Results are written as tab-separated text to standard output
(or to --out); summaries go to standard error.
"""
import argparse, base64, csv, io, json, math, os, re, sys, urllib.request
from array import array

CLASSES = ['rhizome', 'aerial stem', 'root', 'leaf']
ORG_KEYS = ['rhizome', 'stem', 'root', 'leaf']
CROP_NAMES = {'Zinoff': 'Zingiber officinale', 'Curlon': 'Curcuma longa', 'Nelnuc': 'Nelumbo nucifera',
              'Copchi': 'Coptis chinensis', 'Musacu': 'Musa acuminata'}
TRAIT_TESTS = [('Class I KNOX', 'root'), ('Starch synthesis', 'root'), ('Class I KNOX', 'stem'),
               ('Sugar import', 'stem'), ('Soil interface', 'stem')]
DATA = None
_cache = {}


def load(name):
    if name in _cache: return _cache[name]
    if re.match(r'https?://', DATA):
        with urllib.request.urlopen(DATA.rstrip('/') + '/' + name) as r: txt = r.read().decode()
    else:
        with open(os.path.join(DATA, name), encoding='utf-8') as f: txt = f.read()
    _cache[name] = json.loads(txt) if name.endswith('.json') else txt
    return _cache[name]


def say(*a): print(*a, file=sys.stderr)
def og_name(n): return 'OG%07d' % n
def median(v):
    v = sorted(v); n = len(v)
    if not n: return float('nan')
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
LOGF = [0.0]
for i in range(1, 401): LOGF.append(LOGF[-1] + math.log(i))
def sign_p(k, n):
    if n <= 0: return float('nan')
    return min(1.0, sum(math.exp(LOGF[n] - LOGF[i] - LOGF[n - i] - n * math.log(2)) for i in range(k, n + 1)))
def bh(probabilities):
    ordered = sorted((p, i) for i, p in enumerate(probabilities) if p == p)
    result = [float('nan')] * len(probabilities)
    ceiling = float('inf')
    for rank in range(len(ordered), 0, -1):
        p, index = ordered[rank - 1]
        ceiling = min(ceiling, p * len(ordered) / rank)
        result[index] = min(ceiling, 1.0)
    return result
def fmt(v, d=3): return '' if v is None or v != v else ('%.' + str(d) + 'f') % v


# ---------- gene lookup (as the website search) ----------
def norm(s): return str(s or '').strip().upper()
def norm_sym(s): return re.sub(r'\.\d+$', '', norm(s))
def build_lookup():
    rows = load('og_index.json')
    index, aliases = {}, {}
    positions = {row[0]: i for i, row in enumerate(rows)}
    for i, row in enumerate(rows):
        group, members, crops = row[0], row[1], row[3]
        names = [group]
        for member in members:
            names.extend(member[:2])
        for ids in (crops or {}).values():
            names.extend(ids)
        for name in names:
            full = norm(name)
            if not full:
                continue
            for key in (full, norm_sym(full)):
                entries = index.setdefault(key, [])
                if i not in entries:
                    entries.append(i)
    try:
        for name, groups in load('aliases.json').items():
            for group in groups:
                if group not in positions:
                    continue
                matches = aliases.setdefault(norm(name), [])
                if positions[group] not in matches:
                    matches.append(positions[group])
    except Exception:
        pass
    return rows, index, aliases
def og_label(idx_row):
    s = [m[1] for m in idx_row[1] if m[1]]
    return ', '.join(s[:3]) + (', …' if len(s) > 3 else '') if s else idx_row[0]


# ---------- residuals (gene-set scoring, candidates, experiment comparison) ----------
class Residuals:
    def __init__(self):
        d = load('resid.json'); self.ogs = d['ogs']; self.nO = len(self.ogs)
        self.col = {og_name(n): j for j, n in enumerate(self.ogs)}
        self.species = d['species']; self.lineage = d['lineage']; self.comp = {}
        for c in ('root', 'stem'):
            a = array('h'); a.frombytes(base64.b64decode(d[c]['v']))
            if sys.byteorder == 'big': a.byteswap()
            nU = len(d[c]['units']); spU = {}
            for k, u in enumerate(d[c]['units']): spU.setdefault(u[0], []).append(k)
            self.comp[c] = {'M': a, 'nU': nU, 'spU': spU, 'spList': sorted(spU), 'scale': d['scale'], 'S': None, 'cons': None}
    def val(self, c, u, j):
        x = self.comp[c]['M'][u * self.nO + j]
        return float('nan') if x == -32768 else x / self.comp[c]['scale']
    def species_medians(self, comparison):
        block = self.comp[comparison]
        if block['S'] is not None:
            return block['S']
        def aggregate(units):
            if len(units) == 1:
                return [self.val(comparison, units[0], col) for col in range(self.nO)]
            row = []
            for col in range(self.nO):
                measured = [self.val(comparison, unit, col) for unit in units]
                row.append(median([value for value in measured if value == value]))
            return row
        block['S'] = [aggregate(block['spU'][species]) for species in block['spList']]
        return block['S']
    def consensus(self, comparison, exclude=-1):
        block = self.comp[comparison]
        cache = block.setdefault('cache', {})
        if exclude in cache:
            return cache[exclude]
        rows = [row for species, row in zip(block['spList'], self.species_medians(comparison)) if species != exclude]
        consensus = []
        for values in zip(*rows):
            measured = [value for value in values if value == value]
            consensus.append(median(measured) if len(measured) >= 5 else float('nan'))
        cache[exclude] = consensus if rows else [float('nan')] * self.nO
        return cache[exclude]
    def score_set(self, groups):
        columns = [self.col[group] for group in groups if group in self.col]
        result = {'used': len(columns)}
        for comparison, block in self.comp.items():
            def unit_score(unit):
                values = [self.val(comparison, unit, col) for col in columns]
                values = [value for value in values if value == value]
                return sum(values) / len(values) if values else float('nan')
            scores = [unit_score(unit) for unit in range(block['nU'])]
            species_scores = {}
            for species in block['spList']:
                values = [scores[unit] for unit in block['spU'][species]]
                species_scores[species] = median([value for value in values if value == value])
            measured = [(species, value) for species, value in species_scores.items() if value == value]
            values = [value for _, value in measured]
            positive = sum(value > 0 for value in values)
            def lineage_tally(monocot):
                subset = [value for species, value in measured if (self.lineage[species] == 'monocots') == monocot]
                return [sum(value > 0 for value in subset), len(subset)]
            result[comparison] = {'sp': species_scores, 'n': len(values), 'k': positive,
                                  'p': sign_p(positive, len(values)), 'med': median(values),
                                  'mono': lineage_tally(True), 'oth': lineage_tally(False)}
        return result


def cmd_score(a):
    idx, look, alias = build_lookup(); R = Residuals()
    toks = [t for t in re.split(r'[\s,;]+', open(a.input, encoding='utf-8').read()) if t]
    ogs, miss = [], []
    for t in toks:
        hit = look.get(norm(t)) or look.get(norm_sym(t)) or alias.get(norm(t)) or alias.get(norm_sym(t))
        if not hit: miss.append(t); continue
        for i in hit:
            if idx[i][0] not in ogs: ogs.append(idx[i][0])
    if not ogs: sys.exit('No entry matched a gene in the atlas.')
    r = R.score_set(ogs)
    say(f'{len(toks)} entries -> {len(ogs)} orthogroups ({r["used"]} expressed in the comparisons)' + (f'; not found: {", ".join(miss)}' if miss else ''))
    for c, lab in (('root', 'vs root'), ('stem', 'vs aerial stem')):
        x = r[c]; say(f'Rhizome {lab}: {x["k"]}/{x["n"]} species higher in rhizome, sign test P = {x["p"]:.3g}, median score {x["med"]:+.2f}; '
                      f'monocots {x["mono"][0]}/{x["mono"][1]}, other lineages {x["oth"][0]}/{x["oth"][1]}')
    out = [['species', 'lineage', 'score_vs_root', 'score_vs_aerial_stem']]
    order = load('layers.json')['layout']['order']
    for name in order:
        si = R.species.index(name); out.append([name, R.lineage[si], fmt(r['root']['sp'].get(si)), fmt(r['stem']['sp'].get(si))])
    return out


def cmd_candidates(a):
    idx, _, _ = build_lookup(); by_id = {r[0]: r for r in idx}; R = Residuals()
    comps = ['root', 'stem'] if a.compare == 'both' else [a.compare]; st = {}
    for c in comps:
        block = R.comp[c]
        selected = [(row, R.lineage[species] == 'monocots')
                    for species, row in zip(block['spList'], R.species_medians(c))
                    if a.group == 'all' or R.lineage[species] == a.group]
        stats = {key: [] for key in ('N', 'K', 'P', 'Med', 'Rep')}
        nG = len(selected)
        positive = (lambda value: value > 0) if a.direction == 'up' else (lambda value: value < 0)
        for column in range(R.nO):
            measured = []
            counts, hits = [0, 0], [0, 0]
            for row, monocot in selected:
                value = row[column]
                if value != value:
                    continue
                measured.append(value)
                group = int(not monocot)
                counts[group] += 1
                hits[group] += positive(value)
            n, k = len(measured), sum(hits)
            stats['N'].append(n)
            stats['K'].append(k)
            stats['P'].append(sign_p(k, n) if n >= 5 else float('nan'))
            stats['Med'].append(median(measured))
            stats['Rep'].append(a.group == 'all' and all(count >= 5 and sign_p(hit, count) < 0.05
                                                        for hit, count in zip(hits, counts)))
        stats.update(Q=bh(stats['P']), minN=math.ceil(0.65*nG - 1e-9), nG=nG)
        st[c] = stats
    rows = []
    for j in range(R.nO):
        if all(st[c]['N'][j] >= st[c]['minN'] and st[c]['Q'][j] < a.fdr for c in comps):
            rows.append((max(st[c]['Q'][j] for c in comps), max(st[c]['P'][j] for c in comps), j))
    rows.sort()
    word = 'higher' if a.direction == 'up' else 'lower'
    say(f'{len(rows)} gene families {word} in rhizome (' + '; '.join(f'{c}: tested in >= {st[c]["minN"]} of {st[c]["nG"]} species' for c in comps) + ')')
    head = ['orthogroup', 'arabidopsis_symbols', 'description']
    for c in comps: head += [f'{c}_species_tested', f'{c}_species_{word}', f'{c}_median_residual', f'{c}_P', f'{c}_FDR']
    head += ['replicated_in_both_lineage_groups'] + [CROP_NAMES[k].replace(' ', '_') + '_gene_ids' for k in CROP_NAMES]
    out = [head]
    for q, p, j in rows:
        og = og_name(R.ogs[j]); x = by_id.get(og)
        rec = [og, ';'.join(m[1] for m in x[1] if m[1]) if x else '', x[1][0][2] if x and x[1] else '']
        for c in comps: rec += [st[c]['N'][j], st[c]['K'][j], fmt(st[c]['Med'][j]), '%.3g' % st[c]['P'][j], '%.3g' % st[c]['Q'][j]]
        rec.append(('yes' if all(st[c]['Rep'][j] for c in comps) else 'no') if a.group == 'all' else '')
        rec += [';'.join((x[3] or {}).get(k, [])) if x else '' for k in CROP_NAMES]
        out.append(rec)
    return out


# ---------- user count tables ----------
def read_counts(path):
    with open(path, encoding='utf-8-sig') as source:
        lines = [line for line in source.read().splitlines() if line.strip() and not line.startswith('#')]
    if not lines:
        lines = ['']
    delimiter = '\t' if '\t' in lines[0] else ',' if ',' in lines[0] else None
    rows = [line.split(delimiter) for line in lines]
    def is_header(field):
        if not field.strip():
            return False
        try:
            float(field)
        except ValueError:
            return True
        return False
    fields = rows[0][1:]
    has_header = any(map(is_header, fields))
    names = []
    for i, field in enumerate(fields, 1):
        label = field.strip().strip('"\'') if has_header else ''
        names.append(label or f'sample {i}')
    genes, values = [], []
    for row in rows[int(has_header):]:
        try:
            counts = list(map(float, row[1:len(names)+1]))
        except ValueError:
            continue
        if len(counts) != len(names) or not all(count >= 0 for count in counts):
            continue
        genes.append(re.sub(r'^GENE[-:]', '', row[0].strip().strip('"\'').upper()))
        values.append(counts)
    return names, genes, values


class Classifier:
    def __init__(self):
        m = load('clf_model.json'); self.m = m
        for r in m['routes'].values():
            for key, dst in (('w', 'W'), ('mu', 'MU'), ('sd', 'SD')):
                if key in r:
                    a = array('f'); a.frombytes(base64.b64decode(r[key]))
                    if sys.byteorder == 'big': a.byteswap()
                    r[dst] = a
            r['fpos'] = {n: j for j, n in enumerate(r['feats'])}
        self.maps = {'arabidopsis': m['ag']}
        idx = load('og_index.json')
        for k in m['routes']:
            if k in ('og', 'arabidopsis'): continue
            mp = {}
            for r in idx:
                for g in (r[3] or {}).get(k, []): mp[g.upper()] = int(r[0][2:])
            self.maps[k] = mp
    def gene_to_og(self, route, g):
        if route == 'og': return int(g[2:]) if re.match(r'^OG\d{7}$', g) else None
        n = self.maps[route].get(g)
        if n is None and route == 'arabidopsis': n = self.maps[route].get(re.sub(r'\.\d+$', '', g))
        return n
    def map_counts(self, names, genes, vals):
        route_matches = {route: sum(self.gene_to_og(route, gene) is not None for gene in genes)
                         for route in self.m['routes']}
        route = max(route_matches, key=route_matches.get)
        matched = route_matches[route]
        if not matched:
            sys.exit('No gene ID matched Arabidopsis identifiers, the five crop genomes or RhizoAtlas orthogroups.')
        model = self.m['routes'][route]
        samples = [{} for _ in names]
        observed = set()
        for gene, counts in zip(genes, vals):
            group = self.gene_to_og(route, gene)
            if group is None:
                continue
            if group in model['fpos']:
                observed.add(group)
            for sample, count in zip(samples, counts):
                sample[group] = sample.get(group, 0) + count
        return dict(route=route, hit=matched, total=len(genes), coverage=len(observed)/len(model['feats']),
                    og=samples, seen=observed, tot=[sum(sample.values()) for sample in samples], names=names)
    def classify(self, mapped):
        model = self.m['routes'][mapped['route']]
        reliability = self.m.get('reliability', {})
        width, temperature = len(model['feats']), model.get('T', 1.0)
        def predict(name, sample, reads):
            if not reads > 0:
                return {'name': name, 'error': 'no counts'}
            features, measured, means = [], [], []
            distance = 0.0
            for j, group in enumerate(model['feats']):
                if group not in mapped['seen'] and 'MU' in model:
                    features.append(model['MU'][j])
                    continue
                value = math.log2(sample.get(group, 0) / reads * 1e6 + 1)
                features.append(value)
                if 'MU' in model:
                    mean = model['MU'][j]
                    distance += ((value - mean) / model['SD'][j]) ** 2
                    measured.append(value)
                    means.append(mean)
            logits = []
            for category, bias in enumerate(model['b']):
                value = bias
                for j, feature in enumerate(features):
                    if feature != 0:
                        value += model['W'][category * width + j] * feature
                logits.append(value / temperature)
            maximum = max(logits)
            weights = [math.exp(value - maximum) for value in logits]
            total = sum(weights)
            probabilities = [weight / total for weight in weights]
            profile = None
            if len(measured) > 2:
                mx, mu = sum(measured)/len(measured), sum(means)/len(means)
                cross = sum((x-mx)*(u-mu) for x,u in zip(measured, means))
                profile = cross / math.sqrt(sum((x-mx)**2 for x in measured)*sum((u-mu)**2 for u in means))
            warnings = []
            if reliability.get('min_profile_r') and profile is not None and profile < reliability['min_profile_r']:
                warnings.append('profile does not look like raw gene counts: check gene IDs and values')
            elif model.get('d_thr') and measured and distance/len(measured) > model['d_thr']:
                warnings.append('unusual expression profile')
            if reliability.get('min_reads') and reads < reliability['min_reads']:
                warnings.append(f'low depth ({round(reads)} reads)')
            if reliability.get('min_coverage') and mapped['coverage'] < reliability['min_coverage']:
                warnings.append('more than half of model genes missing')
            return dict(name=name, p=probabilities, pred=probabilities.index(max(probabilities)), reads=reads, warn=warnings)
        return [predict(name, sample, reads) for name, sample, reads in zip(mapped['names'], mapped['og'], mapped['tot'])]


def label_check(c, organ):
    if 'p' not in c or organ not in ORG_KEYS: return ''
    k = ORG_KEYS.index(organ)
    if c['p'][k] < 0.1 and max(c['p']) >= 0.8: return 'check label'
    return 'consistent' if c['pred'] == k else 'uncertain'


def guess_organ(name):
    n = name.lower()
    if 'rhizom' in n: return 'rhizome'
    if re.search(r'leaf|leaves|lamina|blade', n): return 'leaf'
    if re.search(r'(^|[^a-z])root|roots', n) and 'rootstock' not in n: return 'root'
    if re.search(r'stem|culm|stalk', n): return 'stem'
    return ''


def cmd_classify(a):
    names, genes, vals = read_counts(a.input); clf = Classifier(); mp = clf.map_counts(names, genes, vals); res = clf.classify(mp)
    say(f'{len(names)} samples; detected {mp["route"]} identifiers: {mp["hit"]} of {mp["total"]} genes matched, {100*mp["coverage"]:.0f}% of model genes present')
    out = [['sample', 'P_rhizome', 'P_aerial_stem', 'P_root', 'P_leaf', 'predicted', 'label_check', 'reads', 'warnings']]
    for c in res:
        if 'p' not in c: out.append([c['name'], '', '', '', '', c['error'], '', '', '']); continue
        out.append([c['name']] + ['%.4f' % v for v in c['p']] + [CLASSES[c['pred']], label_check(c, a.expected or ''), round(c['reads']), '; '.join(c['warn'])])
    return out


def qbin(rank, n): return sum(1 for j in range(1, 10) if 10 * (rank - 1) > (n - 1) * j)
def first_ranks(v):
    ix = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
    for k, i in enumerate(ix): r[i] = k + 1
    return r
def avg_ranks(values):
    from itertools import groupby
    order = sorted(range(len(values)), key=values.__getitem__)
    ranks = [0.0] * len(values)
    offset = 0
    for _, group in groupby(order, key=values.__getitem__):
        tied = list(group)
        rank = (offset + offset + len(tied) - 1)/2 + 1
        for index in tied:
            ranks[index] = rank
        offset += len(tied)
    return ranks
def spearman(x, y):
    rx, ry = avg_ranks(x), avg_ranks(y); n = len(x); m = (n + 1) / 2
    sxy = sum((a - m) * (b - m) for a, b in zip(rx, ry)); sxx = sum((a - m) ** 2 for a in rx); syy = sum((b - m) ** 2 for b in ry)
    return sxy / math.sqrt(sxx * syy)


def experiment_residuals(mapped, organs):
    groups = sorted({group for sample in mapped['og'] for group in sample})
    samples = {organ: [] for organ in ORG_KEYS}
    for i, organ in enumerate(organs):
        if organ in samples and mapped['tot'][i] > 0:
            samples[organ].append(i)
    result = {'n': {organ: len(ids) for organ, ids in samples.items()}, 'res': {}}
    if not samples['rhizome']:
        return result
    def expression(ids):
        return [sum(math.log2(mapped['og'][i].get(group, 0) / mapped['tot'][i] * 1e6 + 1)
                    for i in ids)/len(ids) for group in groups]
    target = expression(samples['rhizome'])
    leaf = expression(samples['leaf']) if samples['leaf'] else None
    for organ in ('root', 'stem'):
        if not samples[organ]:
            continue
        reference = expression(samples[organ])
        expressed = [(group, (x+y)/2, x-y, y-leaf[i] if leaf else 0)
                     for i, (group, x, y) in enumerate(zip(groups, target, reference)) if (x+y)/2 > 0.5]
        size = len(expressed)
        if size < 500:
            result['res'][organ] = None
            continue
        abundance = first_ranks([row[1] for row in expressed])
        strata = [qbin(rank, size) for rank in abundance]
        if leaf:
            depth = first_ranks([row[3] for row in expressed])
            strata = [cell*10+qbin(rank, size) for cell, rank in zip(strata, depth)]
        totals = {}
        for cell, row in zip(strata, expressed):
            total, count = totals.get(cell, (0, 0))
            totals[cell] = total+row[2], count+1
        result['res'][organ] = {row[0]: row[2]-totals[cell][0]/totals[cell][1]
                                for cell, row in zip(strata, expressed)}
    return result


def cmd_analyze(a):
    names, genes, vals = read_counts(a.input); clf = Classifier(); mp = clf.map_counts(names, genes, vals); res = clf.classify(mp)
    organs = [guess_organ(n) for n in names]
    if a.organs:
        given = {}
        for row in csv.reader(open(a.organs, encoding='utf-8-sig'), delimiter='\t'):
            if len(row) >= 2: given[row[0].strip()] = row[1].strip().lower().replace('aerial stem', 'stem')
        organs = [given.get(n, o) for n, o in zip(names, organs)]
    say(f'{len(names)} samples; detected {mp["route"]} identifiers: {mp["hit"]} of {mp["total"]} genes matched')
    for c, o in zip(res, organs):
        if 'p' in c: say(f'  {c["name"]}: organ {o or "not used"}; predicted {CLASSES[c["pred"]]} ' + ' '.join('%.2f' % v for v in c['p']) +
                         (f'; {label_check(c, o)}' if label_check(c, o) else '') + (f'; {"; ".join(c["warn"])}' if c['warn'] else ''))
    ex = experiment_residuals(mp, organs); comps = [c for c in ('root', 'stem') if ex['res'].get(c)]
    if not comps: sys.exit('Assign at least one sample to rhizome and one to root or stem (organs.tsv or sample names).')
    R = Residuals(); L = load('layers.json'); sets = L['sets']; own = R.species.index(a.species) if a.species in R.species else -1
    core = [int(c['og'][2:]) for c in load('classifier.json')['core']]
    say(f'Design: rhizome ({ex["n"]["rhizome"]}) vs ' + ' and '.join(f'{c} ({ex["n"][c]})' for c in comps) + f'; leaves {ex["n"]["leaf"]}')
    summary = [['measure', 'comparison', 'value', 'context']]
    for t, c in TRAIT_TESTS:
        if c not in comps: continue
        mem = [int(o[2:]) for o in sets[t] if int(o[2:]) in ex['res'][c]]
        v = sum(ex['res'][c][n] for n in mem) / len(mem) if mem else float('nan')
        sc = R.score_set(sets[t])[c]; atlas = [x for s, x in sc['sp'].items() if x == x and s != own]
        summary.append([f'trait index: {t}', c, fmt(v), f'higher than {sum(1 for x in atlas if x < v)} of {len(atlas)} atlas species'])
    for c in comps:
        m = ex['res'][c]; cons = R.consensus(c, own); x, y = [], []
        for n, v in m.items():
            j = R.col.get(og_name(n))
            if j is not None and cons[j] == cons[j]: x.append(v); y.append(cons[j])
        summary.append(['agreement with cross-species signature (Spearman rho)', c, fmt(spearman(x, y)), ''])
        summary.append(['core rhizome gene families higher in rhizome', c, f'{sum(1 for n in core if m.get(n, 0) > 0)} of {sum(1 for n in core if n in m)}', ''])
        S = R.species_medians(c); sims = []
        for si, s in enumerate(R.comp[c]['spList']):
            if s == own: continue
            a_, b_ = [], []
            for n, v in m.items():
                j = R.col.get(og_name(n))
                if j is not None and S[si][j] == S[si][j]: a_.append(v); b_.append(S[si][j])
            if len(a_) >= 500: sims.append((spearman(a_, b_), R.species[s]))
        sims.sort(reverse=True)
        summary.append(['most similar atlas species', c, '; '.join(f'{s} ({r:.2f})' for r, s in sims[:3]), ''])
    if a.genes:
        idx = {r[0]: r for r in load('og_index.json')}; allogs = sorted(set().union(*[set(ex['res'][c]) for c in comps]))
        with open(a.genes, 'w', newline='') as f:
            w = csv.writer(f, delimiter='\t'); w.writerow(['orthogroup', 'arabidopsis_symbols', 'description'] + [x for c in comps for x in (f'your_residual_vs_{c}', f'atlas_median_residual_vs_{c}')])
            for n in allogs:
                og = og_name(n); r = idx.get(og); j = R.col.get(og)
                w.writerow([og, ';'.join(m[1] for m in r[1] if m[1]) if r else '', r[1][0][2] if r and r[1] else ''] +
                           [x for c in comps for x in (fmt(ex['res'][c].get(n)), fmt(R.consensus(c, own)[j]) if j is not None else '')])
        say(f'gene-level results written to {a.genes}')
    return summary


def main():
    global DATA
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data'), help='data folder or URL')
    ap.add_argument('--out', help='output file (default: standard output)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('classify'); p.add_argument('input'); p.add_argument('--expected', choices=ORG_KEYS)
    p = sub.add_parser('analyze'); p.add_argument('input'); p.add_argument('--organs'); p.add_argument('--species', default=''); p.add_argument('--genes')
    p = sub.add_parser('score'); p.add_argument('input')
    p = sub.add_parser('candidates'); p.add_argument('--compare', choices=['both', 'root', 'stem'], default='both')
    p.add_argument('--direction', choices=['up', 'down'], default='up'); p.add_argument('--group', choices=['all', 'monocots', 'eudicots'], default='all')
    p.add_argument('--fdr', type=float, default=0.05)
    a = ap.parse_args(); DATA = a.data
    rows = {'classify': cmd_classify, 'analyze': cmd_analyze, 'score': cmd_score, 'candidates': cmd_candidates}[a.cmd](a)
    f = open(a.out, 'w', newline='') if a.out else sys.stdout
    w = csv.writer(f, delimiter='\t', lineterminator='\n')
    for r in rows: w.writerow(r)


if __name__ == '__main__':
    main()
