"""Turns the surgeon preferences card (Aimee's HTML export) into data.

Run once to seed the editable cards: the portal stores and edits the data from
then on. Bold is kept as **double asterisks**, never as HTML — the card is
co-written, and rendering its markup would make an edit into script.

    python3 -I scripts/extract-preferences.py \
        theatre-guides/restricted/surgeon-preferences/index.html > /tmp/seed.json  (then wrap as src/preferences/seed.js)
"""
import html
import json
import re
import sys
from html.parser import HTMLParser


class Card(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.surgeons = []
        self.stack = []          # classes of open elements
        self.cur_s = None        # surgeon
        self.cur_c = None        # system card
        self.field = None        # where text goes
        self.buf = ''
        self.bold = False

    def cls(self, attrs):
        return dict(attrs).get('class', '') or ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        c = a.get('class', '') or ''
        self.stack.append((tag, c))
        if tag == 'section' and 'panel' in c and a.get('id', '').startswith('p-'):
            self.cur_s = {'id': a['id'][2:], 'name': '', 'systems': []}
            self.surgeons.append(self.cur_s)
        elif self.cur_s is not None and tag == 'h2':
            self.start('surgeon')
        elif tag == 'div' and 'sys-card' in c and self.cur_s is not None:
            colour = re.search(r'--sc:\s*(#[0-9A-Fa-f]{3,8})', a.get('style', '') or '')
            self.cur_c = {'name': '', 'subtitle': '', 'colour': colour.group(1) if colour else '',
                          'tag': '', 'items': [], 'alert': None}
            self.cur_s['systems'].append(self.cur_c)
        elif self.cur_c is not None:
            parent = self.stack[-2][1] if len(self.stack) > 1 else ''
            if tag == 'b' and 'sys-tt' in parent:
                self.start('name')
            elif tag == 'span' and 'sys-tt' in parent:
                self.start('subtitle')
            elif tag == 'div' and 'sys-tag' in c:
                self.start('tag')
            elif tag == 'li':
                self.start('item')
            elif tag == 'div' and 'alertbox' in c:
                self.cur_c['alert'] = {'title': '', 'text': ''}
            elif tag == 'b' and 'alertbox' in parent:
                self.start('alert_title')
            elif tag == 'span' and 'alertbox' in parent:
                self.start('alert_text')
            elif tag == 'b' and self.field == 'item':
                self.buf += '**'
                self.bold = True

    def start(self, field):
        self.field = field
        self.buf = ''

    def handle_endtag(self, tag):
        if tag == 'b' and self.field == 'item' and self.bold:
            self.buf += '**'
            self.bold = False
            self.stack.pop()
            return
        if self.field and tag in ('h2', 'b', 'span', 'div', 'li'):
            text = re.sub(r'\s+', ' ', self.buf).strip().replace('****', '')
            f = self.field
            if f == 'surgeon':
                self.cur_s['name'] = text
            elif f == 'name':
                self.cur_c['name'] = text
            elif f == 'subtitle':
                self.cur_c['subtitle'] = text
            elif f == 'tag':
                self.cur_c['tag'] = text
            elif f == 'item':
                self.cur_c['items'].append(text)
            elif f == 'alert_title':
                self.cur_c['alert']['title'] = text
            elif f == 'alert_text':
                self.cur_c['alert']['text'] = text
            if not (f == 'item' and tag != 'li'):
                self.field = None
        if tag == 'section':
            self.cur_s = None
            self.cur_c = None
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.field:
            self.buf += data


p = Card()
p.feed(open(sys.argv[1], encoding='utf8').read())
json.dump({'surgeons': p.surgeons}, sys.stdout, ensure_ascii=False, indent=1)
sys.stdout.write('\n')
