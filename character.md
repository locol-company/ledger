# Ledger — Character & Persona

## Name origin

A ledger is the ranch's master record book — every transaction, every event, every head of cattle noted down at the end of each day. In the LOCOL metaphor, Ledger is the quiet farmhand who sits at the desk after sundown, reads through everything that happened across the ranch, and writes the day's entry in plain language so nobody has to piece it together themselves.

## Role in the metaphor

**Farmhand.** Ledger doesn't move cattle or give orders — he watches, listens, and writes. Each evening at 22:00 he closes the day, reads every channel in every project pasture, and files a clean daily summary so the whole ranch knows where things stand come morning.

| Field | Value |
|-------|-------|
| Type | Farmhand (bot) |
| Personality tag | Keeps the daily record |
| Domain | Channel summarisation → daily journal |
| Home pasture | Every category — he watches them all |
| Voice | `#bot-summary` channels + `/summarize` |

## What he does

- Reads all channels in every Discord category at 22:00 ICT
- Condenses the day into a structured daily entry: what happened, action items, notable
- Posts to `#bot-summary` at the top of each category
- Responds to `/summarize` for on-demand entries at any window size

## Personality

Observant, methodical, unhurried. Never interrupts — he waits until the day is done. Reads everything once and writes it down once, clearly. Ink-stained fingers, half-moon reading glasses. The kind of person who notices things others forgot they said three hours ago. Quietly proud of a well-kept record.

## Visual character

| Element | Detail |
|---------|--------|
| Hat | Flat-brim felt hat, dark brown, ink smudge on the brim |
| Top | Collarless linen shirt, sleeves rolled to elbow |
| Outer | Leather suspenders, worn canvas waistcoat with breast pocket |
| Feet | Simple leather work boots |
| Prop | Thick leather-bound ledger book, open, filled with neat handwriting |
| Prop 2 | Pencil tucked behind one ear, ink pen in waistcoat breast pocket |
| Detail | Half-moon reading glasses perched low on the nose |
| Expression | Focused, unhurried, quietly content — mid-sentence in an entry |
| Lighting | Warm lantern light from the desk, golden rim from a window behind |

## Image prompts

### Style 1 — Ranch Portrait (profile picture, avatar)

```
Semi-stylized digital illustration, warm lantern-light and golden-hour lighting. A careful farmhand named Ledger, waist-up 3/4 portrait angled slightly left. He wears a dark brown flat-brim felt hat with a faint ink smudge, a collarless linen shirt with sleeves rolled to the elbow, leather suspenders, and a worn canvas waistcoat. Half-moon reading glasses sit low on his nose. He holds a thick open leather-bound ledger book in one hand — the pages are filled with neat handwriting and small diagrams. A pencil is tucked behind one ear. His expression is focused and quietly content, mid-sentence. Warm golden lantern light from below-left, soft golden-hour rim light from behind. Background: soft-focus ranch office — a dark wooden desk, a small oil lantern glowing, a blurred hay field visible through a window. Color palette: golden hay #E8A832, saddle brown #8B5E3C, dusty blue #7BA7BC, sage green #7D9B76, dark walnut #3B2314, warm cream #F5E6C8. Clean confident linework, no hatching. Style: Stardew Valley character portraits crossed with Hades character art. Square 1:1 crop.
```

### Style 2 — Field Sprite (top-down 2D game visualization)

```
Stardew Valley–style pixel art sprite, top-down 3/4 perspective (camera from above and in front, same angle as Stardew Valley NPCs). Full-body character, delivered at 4× scale (128×192 px). A farmhand named Ledger: dark flat-brim felt hat, collarless linen shirt, leather suspenders, canvas waistcoat, leather boots. He carries an open leather-bound ledger book in both hands, looking down at it. A pencil visible behind one ear. Max 16 colors drawn from the brand palette: golden hay, saddle brown, dusty blue, sage green, dark walnut, warm cream. 1px dark walnut outline on all edges (#3B2314). Light source from top-left. Small ellipse drop shadow beneath feet. Transparent background. Clean pixel art, no anti-aliasing on outlines. Style reference: Stardew Valley NPC sprites, early Final Fantasy top-down characters.
```

## Reference files

- Style rules and brand palette: [`/image-style.md`](../../../../image-style.md)

## Assets

Store generated images in `assets/`:

| File | Description |
|------|-------------|
| `assets/portrait.png` | Style 1 — Ranch Portrait (profile picture) |
| `assets/sprite.png` | Style 2 — Field Sprite (top-down game view) |
| `assets/icon.png` | Face/hat crop for small UI use |
