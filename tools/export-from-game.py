#!/usr/bin/env python3
"""
For Louis: re-export the Old Town from a checkout of the AltstadtAuto game repository (closed
source, private) into this pack. Readers of this repository never need it.

    python3 tools/export-from-game.py <game checkout>                  # main
    python3 tools/export-from-game.py <game checkout> v0.3.0-alpha
    python3 tools/export-from-game.py <game checkout> main --apply

What it does:
  1. Reads every map file at <ref> with `git show` (the checkout's working tree is not touched).
  2. Applies the pack's import paths and comment edits, so a 'synced' file comes out exactly as
     the pack keeps it.
  3. Writes the results to tools/.staging/<ref>/ and prints, for every file, whether it matches
     the pack.
  4. With --apply, copies the 'synced' files that changed into code/ and records the commit in
     code/GAME_COMMIT. 'adapted' files are never overwritten: they carry pack-specific
     rewrites (see code/PROVENANCE.md), so the script shows their diff for a manual merge.

After a re-export: open the viewer, check it builds with no console errors, and regenerate
data/oldtown-plan.json with the viewer's "Export plan .json" button.
"""
import os, re, subprocess, sys, difflib

PACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# game path -> pack path, and whether the pack keeps it as an automatic copy ('synced') or a
# hand-adapted version ('adapted')
FILES = {
    'oldtown/plan.js': ('code/oldtown/plan.js', 'synced'),
    'oldtown/river.js': ('code/oldtown/river.js', 'synced'),
    'oldtown/bridges.js': ('code/oldtown/bridges.js', 'synced'),
    'oldtown/materials.js': ('code/oldtown/materials.js', 'synced'),
    'oldtown/prison.js': ('code/oldtown/prison.js', 'synced'),
    'oldtown/buildings/house.js': ('code/oldtown/buildings/house.js', 'synced'),
    'oldtown/buildings/ground.js': ('code/oldtown/buildings/ground.js', 'synced'),
    'oldtown/buildings/landmarks.js': ('code/oldtown/buildings/landmarks.js', 'synced'),
    'oldtown/buildings/roof.js': ('code/oldtown/buildings/roof.js', 'synced'),
    'oldtown/buildings/merge.js': ('code/oldtown/buildings/merge.js', 'synced'),
    'oldtown/buildings/kit.js': ('code/oldtown/buildings/kit.js', 'synced'),
    'oldtown/buildings/index.js': ('code/oldtown/buildings/index.js', 'synced'),
    'world/sky.js': ('code/world/sky.js', 'synced'),
    'world/glow.js': ('code/world/glow.js', 'synced'),
    'world/shadows.js': ('code/world/shadows.js', 'synced'),
    'world/surfacegen.js': ('code/world/surfacegen.js', 'synced'),
    'world/surfaceworker.js': ('code/world/surfaceworker.js', 'synced'),
    'oldtown/index.js': ('code/oldtown/index.js', 'adapted'),
    'oldtown/streets.js': ('code/oldtown/streets.js', 'adapted'),
    'oldtown/furniture.js': ('code/oldtown/furniture.js', 'adapted'),
    'oldtown/placeholder.js': ('code/oldtown/placeholder.js', 'adapted'),
    'oldtown/sites.js': ('code/oldtown/sites.js', 'adapted'),
    'oldtown/nav.js': ('code/oldtown/walklines.js', 'adapted'),
    'oldtown/buildings/details.js': ('code/oldtown/buildings/details.js', 'adapted'),
    'world/surfaces.js': ('code/world/surfaces.js', 'adapted'),
    'world/levelkit.js': ('code/engine/levelkit.js', 'adapted'),
    'app/post.js': ('code/engine/post.js', 'adapted'),
}

IMPORTS = [
    ("'../world/collision.js'", "'../engine/collision.js'"),
    ("'../cityparts.js'", "'../engine/parts.js'"),
    ("'../world/rng.js'", "'../engine/rng.js'"),
    ("'../citystore.js'", "'../engine/shops.js'"),
    ("'../carmodel.js'", "'../engine/parking.js'"),
    ("'../../world/collision.js'", "'../../engine/collision.js'"),
    ("'../../cityparts.js'", "'../../engine/parts.js'"),
    ("'../../world/rng.js'", "'../../engine/rng.js'"),
]
WORLD_IMPORTS = [("from './rng.js'", "from '../engine/rng.js'")]

COMMENTS = [
    ("app/post.js", "engine/post.js"),
    ("app/culling.js box-culls them against the sun", "engine/levelkit.js shadowLayerPass lets only the shadow pass draw them"),
    ("(app/settingswire.js, from the quality preset)", "(the host picks it, e.g. from a quality preset)"),
    ("that app/prison.js swings and unblocks", "that a game can swing and unblock"),
    ("(app/prison.js swaps its walk box out)", "(a game can swap its walk box out)"),
    ("the cart is app/prison.js's (it moves)", "the cart is left to a game (it moves)"),
    ("a microtask: main.js awaits", "a microtask: the caller awaits"),
    ("(traffic.js: U-turn at END - 5 +- 3.8)", "(traffic U-turns at END - 5 +- 3.8)"),
    ("(doors on +z: citystore.js)", "(doors on +z: engine/shops.js)"),
    ("(the nature lane takes these over)", "(empty in this version: furniture.js plants the trees)"),
    ("Squares are open ground; sites are handed to the buildings lane.", "Squares are open ground; sites get the landmarks (buildings/landmarks.js)."),
    ("  For the level / buildings / materials lanes:", "  API:"),
    ("(crime/atms.js hangs cash machines on the solid wall between them)", "(the solid wall between them is left for a game to dress)"),
    ("// ---------- trees (placeholders for the nature lane) ----------", "// ---------- trees ----------"),
    ("A lot (see the contract) becomes", "A lot (plan.js) becomes"),
    ("// ground floor storey (contract)", "// ground floor storey"),
]


def git_show(repo, ref, path):
    r = subprocess.run(['git', '-C', repo, 'show', f'{ref}:{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def transform(src, path):
    # (the game's internal design-notes references are dropped)
    src = re.sub(r"The old town's buildings \(see [^)]*\):", "The old town's buildings:", src)
    for a, b in (WORLD_IMPORTS if path.startswith('world/') else IMPORTS):
        src = src.replace(a, b)
    for a, b in COMMENTS:
        src = src.replace(a, b)
    return src


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    apply = '--apply' in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    repo, ref = args[0], (args[1] if len(args) > 1 else 'main')
    commit = subprocess.run(['git', '-C', repo, 'rev-parse', '--short', ref], capture_output=True, text=True).stdout.strip()
    if not commit:
        sys.exit(f'not a git ref in {repo}: {ref}')
    stage = os.path.join(PACK, 'tools', '.staging', ref.replace('/', '_'))
    os.makedirs(stage, exist_ok=True)
    print(f'game {repo} at {ref} ({commit})\n')
    changed = []
    for gpath, (ppath, kind) in FILES.items():
        src = git_show(repo, ref, gpath)
        if src is None:
            print(f'  MISSING  {gpath} (moved or deleted in the game: update FILES)')
            continue
        out = transform(src, gpath)
        dst = os.path.join(stage, ppath)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'w').write(out)
        cur_path = os.path.join(PACK, ppath)
        cur = open(cur_path).read() if os.path.exists(cur_path) else ''
        if kind == 'synced':
            same = cur == out
            print(f'  {"same   " if same else "CHANGED"}  {ppath}')
            if not same:
                changed.append((ppath, out))
        else:
            n = sum(1 for l in difflib.unified_diff(cur.splitlines(), out.splitlines(), lineterm='') if l[:1] in '+-')
            print(f'  adapted  {ppath}: {n} differing lines vs the game (diff -u {ppath} {os.path.relpath(dst, PACK)})')
    print(f'\nstaged in {os.path.relpath(stage, PACK)}')
    if apply:
        for ppath, out in changed:
            open(os.path.join(PACK, ppath), 'w').write(out)
            print(f'  updated {ppath}')
        open(os.path.join(PACK, 'code', 'GAME_COMMIT'), 'w').write(f'{commit}\n')
        print(f'code/GAME_COMMIT = {commit}')
    elif changed:
        print('run again with --apply to copy the CHANGED synced files')


if __name__ == '__main__':
    main()
