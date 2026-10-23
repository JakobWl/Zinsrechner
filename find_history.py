import os, json, datetime

base = os.path.expandvars(r'%APPDATA%\Code\User\History')
results = []
for d in os.listdir(base):
    jp = os.path.join(base, d, 'entries.json')
    if not os.path.isfile(jp):
        continue
    try:
        obj = json.load(open(jp, encoding='utf-8'))
    except Exception:
        continue
    res = obj.get('resource', '')
    if 'AppLayout' not in res:
        continue
    for e in obj.get('entries', []):
        ts = e.get('timestamp', 0)
        fid = e.get('id', '')
        fp = os.path.join(base, d, fid)
        if os.path.isfile(fp):
            results.append((ts, fp, d))
results.sort(key=lambda x: x[0], reverse=True)
print('Found', len(results), 'backups for AppLayout')
for ts, fp, d in results[:30]:
    dt = datetime.datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d %H:%M:%S')
    sz = os.path.getsize(fp)
    print(dt, sz, fp)

print('\n--- content check ---')
for ts, fp, d in results[:15]:
    try:
        s = open(fp, encoding='utf-8', errors='replace').read()
    except Exception as ex:
        print('read err', ex); continue
    dt = datetime.datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d %H:%M:%S')
    print(dt, 'KbdAnchor=%d'%s.count('KbdAnchor'), 'KbdHint=%d'%s.count('KbdHint'),
          'data-kbd=%d'%s.count('data-kbd'), 'len=%d'%len(s), fp)