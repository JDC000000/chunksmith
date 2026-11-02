# Play Chunksmith locally (10-min setup)

For Mac (Jon's setup). ~5 min install, then play as long as you want.

## Prerequisites — one-time only

Open **Terminal.app** (⌘-Space → "Terminal").

```bash
# Check what you have:
node --version
```

**If that prints `v20.x.x` or higher** → skip to "Clone + run" below.

**If you get "command not found"** or a version below 20:
```bash
# Install Homebrew (if you don't have it — one-time) + Node 22:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22
```
Takes 3-5 min. Then open a new Terminal window.

## Clone + run (3 commands)

```bash
cd ~/Documents/Claude/Projects
git clone https://github.com/JDC000000/chunksmith.git
cd chunksmith
npm install
npm run dev
```

**Expected output** at the end:
```
  VITE v8.x.x  ready in 400ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Open `http://localhost:5173/` in Chrome (or Firefox or Safari — Chrome is best tested).

## What you'll see

- Sky-blue background, a flat green chunk of voxel ground floating in space
- A dark card in the middle: **"Chunksmith — Click to play"**
- A hotbar at the bottom with 3 slots: `grass | dirt | stone`

## Play

1. **Click** anywhere on the page → mouse cursor disappears, you're in the game
2. **Move**:
   - **W/A/S/D** — walk forward/left/back/right
   - **Mouse** — look around
3. **Interact**:
   - **Left-click** — break the block you're looking at (the ground chunk)
   - **Right-click** — place the currently-selected block
4. **Hotbar**:
   - **1, 2, 3** — switch block type (grass, dirt, stone)
   - **Mouse wheel** — cycle selection
5. **Pause**: press **Esc** → cursor comes back, overlay returns. Click again to resume.

## What to look for in a 10-min playtest

The game right now is Level 1 + Level 2 feature-complete — walking, placing, breaking, chunk streaming — but **textures aren't done yet** (Day 6b, in progress). Everything renders flat green. Fine for testing mechanics; aesthetics come next.

**Honest expectations:**
- ✅ Walking + looking should feel smooth (60 FPS)
- ✅ Placing a block in the air (right-click on a block face) should feel instant
- ✅ Breaking a block should feel instant
- ✅ Hotbar keys should respond immediately
- ✅ The world should feel "big" — you can walk any direction and new chunks stream in
- 🟡 It'll look flat and monocolor until Day 6b (texture atlas) lands
- 🟡 No gravity yet (you can "fly") — that's Day 3-equivalent polish that got deferred for L3
- 🟡 No audio, no mobs, no biomes — that's Levels 3-4

## Try pushing the limits

```
http://localhost:5173/?radius=4,2
```
That URL loads **9×9×5 = 405 chunks** instead of the default 27. More to walk through. Watch the FPS — on your Mac you should still see 60 easily.

```
http://localhost:5173/?radius=8,4
```
Full L2-spec load: **17×17×9 = 2,601 chunks**. Takes 1-2 seconds to load initially. ~437,000 triangles total. Should still hit 60 FPS on your 2020+ Mac.

## Stop

In the Terminal: **Ctrl-C** stops the dev server.

To re-run later:
```bash
cd ~/Documents/Claude/Projects/chunksmith
npm run dev
```

## If something breaks

- **"Cannot find module three"** → `npm install` again
- **"Address in use :5173"** → something else is on that port. `npm run dev -- --port=5174`
- **Blank screen, console errors** → open DevTools (⌘-Option-I in Chrome) and paste the first error into chat with me
- **Game feels sluggish** → check the FPS counter (not visible yet; add `?debug=1` later for Day 3-ish debug tooling). On M1+ Macs it should be rock-steady 60.

## What to tell me after your playtest

The thing I can't judge: **feel**. Three bullets would be great:
1. What was surprising, good or bad?
2. Did anything feel wrong (controls, speed, UI placement)?
3. One thing you'd ship with vs. one thing that needs fixing

I'll fold that into Day 6b/Day 7 polish before deploy.
