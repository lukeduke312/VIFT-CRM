#!/usr/bin/env python3
"""Höjer ?v=N i index.html för varje fil som ändrats jämfört med HEAD och
ännu inte fått en högre version än i HEAD. Används före commit så att
Service Workern (cache-first för versionsatta filer) aldrig serverar gammal kod.
Kör: python3 tools/bump-versions.py"""
import re, subprocess, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
head_idx = subprocess.run(['git', 'show', 'HEAD:index.html'], capture_output=True, text=True).stdout
pat = r'((?:src|href)="([^"?]+\.(?:js|css))\?v=)(\d+)(")'
head = {m[0]: int(m[1]) for m in re.findall(r'(?:src|href)="([^"?]+\.(?:js|css))\?v=(\d+)"', head_idx)}
changed = set(subprocess.run(['git', 'diff', '--name-only', 'HEAD'], capture_output=True, text=True).stdout.split())
changed |= set(subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'], capture_output=True, text=True).stdout.split())
idx = open('index.html', encoding='utf-8').read()
bumped = []
def rep(m):
    f, v = m.group(2), int(m.group(3))
    if f in changed and f in head and v <= head[f]:
        bumped.append(f'{f} {v}->{head[f] + 1}')
        return m.group(1) + str(head[f] + 1) + m.group(4)
    return m.group(0)
idx = re.sub(pat, rep, idx)
open('index.html', 'w', encoding='utf-8').write(idx)
print('\n'.join(bumped) or 'inget att höja')
