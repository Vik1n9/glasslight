#!/usr/bin/env python3
"""Build the Chrome Web Store package: dist/glasslight-<version>.zip

Strips development-only pieces (dev-reload.js), forces the service worker's
DEV flag off, and validates the result: every file the manifest references
exists, locales share one key set, and descriptions fit the 132-character
manifest limit.
"""
import json
import pathlib
import shutil
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
DEV_ONLY = {'src/content/dev-reload.js'}
INCLUDE = ['manifest.json', '_locales', 'icons', 'src', 'LICENSE']


def fail(msg):
    sys.exit(f'build: {msg}')


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    version = manifest['version']

    # Release manifest: no dev reload.
    for cs in manifest['content_scripts']:
        cs['js'] = [f for f in cs.get('js', []) if f not in DEV_ONLY]

    stage = DIST / f'glasslight-{version}'
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    for item in INCLUDE:
        src = ROOT / item
        if src.is_dir():
            shutil.copytree(src, stage / item)
        else:
            shutil.copy2(src, stage / item)
    for rel in DEV_ONLY:
        (stage / rel).unlink(missing_ok=True)
    (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    # A sideloaded zip has no update_url, so the runtime check would treat this
    # package as a dev build. Force it off here; the source tree is unchanged.
    bg_path = stage / 'src/background.js'
    bg = bg_path.read_text()
    dev_line = "const DEV = !('update_url' in manifest); // unpacked install"
    if bg.count(dev_line) != 1:
        fail('expected exactly one unpacked DEV check in src/background.js')
    bg_path.write_text(bg.replace(dev_line, 'const DEV = false;', 1))
    patched = bg_path.read_text()
    if 'const DEV = false;' not in patched or 'update_url' in patched:
        fail('failed to disable DEV in the release service worker')

    # ---- validation ----
    # The support button must point at the real checkout before anything ships.
    options_js = (stage / 'src/options/options.js').read_text()
    if 'example.com' in options_js:
        fail('src/options/options.js: DONATE_URL is still the test link (example.com)')

    referenced = {manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_ui']['page']}
    referenced |= set(manifest['icons'].values()) | set(manifest['action']['default_icon'].values())
    for cs in manifest['content_scripts']:
        referenced |= set(cs.get('js', [])) | set(cs.get('css', []))
    missing = [f for f in sorted(referenced) if not (stage / f).exists()]
    if missing:
        fail(f'missing files: {missing}')

    locales = {p.parent.name: json.loads(p.read_text()) for p in (stage / '_locales').glob('*/messages.json')}
    keys = {name: set(m) for name, m in locales.items()}
    ref = keys[manifest['default_locale']]
    for name, k in keys.items():
        if k != ref:
            fail(f'locale {name} keys differ: {sorted(k ^ ref)}')
        desc = locales[name]['extDescription']['message']
        if len(desc) > 132:
            fail(f'locale {name} description is {len(desc)} chars (max 132)')

    # The options page's descriptions: one file per locale, same keys as English.
    descs = {p.stem: json.loads(p.read_text()) for p in (stage / 'src/options/descriptions').glob('*.json')}
    if set(descs) != set(locales):
        fail(f'options descriptions {sorted(descs)} do not match locales {sorted(locales)}')
    for name, d in descs.items():
        if set(d) != set(descs['en']):
            fail(f'options descriptions {name} keys differ: {sorted(set(d) ^ set(descs["en"]))}')

    # ---- zip ----
    out = DIST / f'glasslight-{version}.zip'
    out.unlink(missing_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(stage))
    files = sum(1 for p in stage.rglob('*') if p.is_file())
    print(f'{out.relative_to(ROOT)}  ({files} files, {out.stat().st_size // 1024} KiB, locales: {", ".join(sorted(locales))})')


if __name__ == '__main__':
    main()
