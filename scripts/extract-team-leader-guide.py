# ─── Re-sync src/teamLeader/guide.js from the TM Team Leader artifact ────────
#
#   1. Ask Claude Code to fetch the artifact; it saves the page under the
#      session's tool-results directory.
#   2. Point ARTIFACT at that file.
#   3. python3 scripts/extract-team-leader-guide.py > /tmp/guide.json
#   4. Regenerate src/teamLeader/guide.js and read the diff.
#
# Mechanical rather than retyped, because a transcription slip in an operating
# procedure is not a cosmetic bug. The companion test asserts every word of the
# saved page survives into the module, so a markup shape this script does not
# know about fails loudly instead of dropping a line.
#
# Inline emphasis becomes structured runs, never HTML: the artifact is
# co-written, and passing its markup into the app would turn an edit to a shared
# document into script running in the staff portal.

import re, glob, json, html as H

p = glob.glob('/Users/brent/.claude/projects/-Users-brent-Downloads-technomed-leave/'
              '89af8634-2fc0-4370-a45d-868c9b97104b/tool-results/artifact-799bedc0-*.html')[-1]
s = open(p, encoding='utf-8', errors='replace').read()
s = s[s.find('<!DOCTYPE html>', 100):]

def runs(frag):
    """Inline HTML -> [{t, b?}] runs. Never raw HTML: the artifact is co-written."""
    frag = re.sub(r'<br\s*/?>', ' ', frag)
    out, pos = [], 0
    for m in re.finditer(r'<(b|i)>(.*?)</\1>', frag, re.S):
        before = re.sub(r'<[^>]+>', '', frag[pos:m.start()])
        if before.strip(): out.append({'t': H.unescape(before)})
        inner = re.sub(r'<[^>]+>', '', m.group(2))
        if inner.strip(): out.append({'t': H.unescape(inner), 'b': True})
        pos = m.end()
    tail = re.sub(r'<[^>]+>', '', frag[pos:])
    if tail.strip(): out.append({'t': H.unescape(tail)})
    for r in out: r['t'] = re.sub(r'\s+', ' ', r['t'])
    # Trim the outer edges only, so spacing between runs survives.
    if out: out[0]['t'] = out[0]['t'].lstrip(); out[-1]['t'] = out[-1]['t'].rstrip()
    return [r for r in out if r['t']]

def plain(frag):
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', frag))).strip()

def slug(text, used):
    base = re.sub(r'[^a-z0-9]+', '-', text.lower())[:48].strip('-') or 'item'
    n, out = 2, base
    while out in used: out = f'{base}-{n}'; n += 1
    used.add(out); return out

# Unescaped like everything else: "Lists &amp; Staff" would otherwise render
# with the entity showing.
TAB_LABELS = {k: H.unescape(v)
              for k, v in re.findall(r'<label for="t-([a-z-]+)">([^<]+)</label>', s)}
panels = re.findall(r'<section class="panel" id="([a-z-]+)">(.*?)</section>', s, re.S)
used_ids, tabs = set(), []

for pid, body in panels:
    blocks = []
    # Walk the panel in document order.
    pattern = re.compile(
        r'<span class="pill[^"]*"(?: style="[^"]*")?>(?P<pill>.*?)</span>'
        r'|<h2>(?P<h2>.*?)</h2>'
        r'|<h3>(?P<h3>.*?)</h3>'
        r'|<p class="lead">(?P<lead>.*?)</p>'
        r'|<div class="block">(?P<block>.*?)</div>\s*(?=<label|<div class="block")'
        r'|<label class="check">(?P<check>.*?)</label>'
        r'|<div class="step"><div class="num">(?P<num>.*?)</div><div class="body">(?P<sbody>.*?)</div></div>'
        r'|<div class="ib(?P<ibmod>[^"]*)"><div class="ic">(?P<ic>.*?)</div><div class="bd">(?P<bd>.*?)</div></div>'
        r'|<div class="callout(?P<tone>[^"]*)">(?P<callout>.*?)</div>'
        r'|<div class="grp(?P<grpmod>[^"]*)">(?P<grp>.*?)</div>\s*</div>'
        r'|<table>(?P<table>.*?)</table>'
        r'|<ul>(?P<ul>.*?)</ul>'
        r'|<summary>(?P<summary>.*?)</summary>'
        r'|<p class="hint">(?P<hint>.*?)</p>'
        r'|<p style="[^"]*">(?P<note>.*?)</p>'
        r'|<p>(?P<p>.*?)</p>', re.S)

    for m in pattern.finditer(body):
        g = m.groupdict()
        if g['pill']: blocks.append({'type': 'pill', 'text': plain(g['pill'])})
        elif g['h2']: blocks.append({'type': 'heading', 'text': plain(g['h2'])})
        elif g['h3']: blocks.append({'type': 'subheading', 'text': plain(g['h3'])})
        elif g['lead']: blocks.append({'type': 'lead', 'runs': runs(g['lead'])})
        elif g['block'] is not None:
            b = g['block']
            blocks.append({'type': 'group',
                           'icon': plain(re.search(r'<div class="dot">(.*?)</div>', b).group(1)),
                           'title': plain(re.search(r'<div class="bt">(.*?)</div>', b).group(1)),
                           'note': plain((re.search(r'<div class="bti">(.*?)</div>', b) or [None, ''])[1])
                                   if re.search(r'<div class="bti">', b) else ''})
        elif g['check']:
            c = g['check']
            title = plain(re.search(r'<b>(.*?)</b>', c).group(1))
            det = re.search(r'</b><span>(.*?)</span>', c, re.S)
            blocks.append({'type': 'check', 'id': slug(title, used_ids),
                           'title': title, 'detail': plain(det.group(1)) if det else ''})
        elif g['num']:
            t = re.search(r'<b>(.*?)</b>', g['sbody'])
            det = re.search(r'</b><span>(.*?)</span>', g['sbody'], re.S)
            blocks.append({'type': 'step', 'num': plain(g['num']),
                           'title': plain(t.group(1)) if t else plain(g['sbody']),
                           'detail': plain(det.group(1)) if det else ''})
        elif g['ic']:
            t = re.search(r'<b>(.*?)</b>', g['bd'])
            det = re.search(r'</b><span>(.*?)</span>', g['bd'], re.S)
            blocks.append({'type': 'tile', 'icon': plain(g['ic']),
                           'title': plain(t.group(1)) if t else plain(g['bd']),
                           'detail': plain(det.group(1)) if det else ''})
        elif g['callout'] is not None:
            tone = (g['tone'] or '').strip() or 'default'
            blocks.append({'type': 'callout', 'tone': tone, 'runs': runs(g['callout'])})
        elif g['grp'] is not None:
            gr = g['grp']
            name = re.search(r'<b>(.*?)</b>', gr)
            tag = re.search(r'<span class="tag ([a-z]+)">(.*?)</span>', gr)
            mem = re.search(r'<div class="mem">(.*?)$', gr, re.S)
            blocks.append({'type': 'group-row',
                           'name': plain(name.group(1)) if name else '',
                           'tag': plain(tag.group(2)) if tag else '',
                           'tagKind': tag.group(1) if tag else '',
                           'key': 'key' in (g['grpmod'] or ''),
                           'runs': runs(mem.group(1)) if mem else []})
        elif g['table']:
            head = [plain(x) for x in re.findall(r'<th>(.*?)</th>', g['table'])]
            rows = [[{'text': plain(c[1]), 'kind': (c[0] or '').strip()}
                     for c in re.findall(r'<td(?: class="([a-z]+)")?>(.*?)</td>', r)]
                    for r in re.findall(r'<tr>(.*?)</tr>', g['table'], re.S)[1:]]
            blocks.append({'type': 'table', 'head': head, 'rows': [r for r in rows if r]})
        elif g['ul']:
            blocks.append({'type': 'list',
                           'items': [runs(li) for li in re.findall(r'<li>(.*?)</li>', g['ul'], re.S)]})
        elif g['summary']: blocks.append({'type': 'divider', 'text': plain(g['summary'])})
        elif g['hint']: blocks.append({'type': 'hint', 'text': plain(g['hint'])})
        elif g['note']: blocks.append({'type': 'note', 'runs': runs(g['note'])})
        elif g['p']: blocks.append({'type': 'para', 'runs': runs(g['p'])})

    tabs.append({'id': pid, 'label': TAB_LABELS.get(pid, pid), 'blocks': blocks})

print(json.dumps(tabs, ensure_ascii=False, indent=1))
