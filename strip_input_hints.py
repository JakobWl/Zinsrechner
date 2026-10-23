import io, re

field_names = {'bankName', 'kontoNumber', 'dateRange', 'zinssatz',
               'nominal', 'dayCountConvention', 'quarter-range'}

p = 'src/AppLayout.tsx'
raw = io.open(p, encoding='utf-8').read()
crlf = '\r\n' in raw
text = raw.replace('\r\n', '\n')
lines = text.split('\n')

out = []
i = 0
n = len(lines)
while i < n:
    line = lines[i]
    # Detect a standalone <KbdAnchor> opening tag
    if line.strip() == '<KbdAnchor>':
        anchor_indent = len(line) - len(line.lstrip(' '))
        # collect inner until matching </KbdAnchor>
        j = i + 1
        inner = []
        while j < n and lines[j].strip() != '</KbdAnchor>':
            inner.append(lines[j])
            j += 1
        # j points at </KbdAnchor>
        block_has_corner = any('variant="corner"' in l for l in inner)
        if block_has_corner:
            # Input anchor: unwrap, drop KbdHint + data-kbd lines, dedent by 2
            for ln in inner:
                st = ln.strip()
                if st.startswith('<KbdHint') and 'variant="corner"' in st and st.endswith('/>'):
                    continue
                m = re.match(r'^\s*data-kbd="([^"]+)"\s*$', ln)
                if m and m.group(1) in field_names:
                    continue
                # dedent by 2 spaces
                if ln.startswith('  '):
                    out.append(ln[2:])
                else:
                    out.append(ln)
        else:
            # button anchor: keep verbatim
            out.append(line)
            out.extend(inner)
            out.append(lines[j])
        i = j + 1
        continue
    out.append(line)
    i += 1

result = '\n'.join(out)
if crlf:
    result = result.replace('\n', '\r\n')
io.open(p, 'w', encoding='utf-8', newline='').write(result)
print('AppLayout updated, len', len(result))

# sanity checks
chk = result
print('remaining corner hints:', chk.count('variant="corner"'))
print('remaining KbdAnchor:', chk.count('<KbdAnchor>'))
for fn in field_names:
    print('data-kbd', fn, ':', chk.count('data-kbd="' + fn + '"'))