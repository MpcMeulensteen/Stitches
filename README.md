# Stitch Pattern Studio

A browser app for designing stitch patterns: cross stitch, knitting colourwork, crochet (tapestry / C2C), diamond painting and beading.
It is a plain static website (HTML, CSS and JavaScript). There is no build step and no server code.

## Running it

**Quick start:** double-click `index.html`. This works in Chrome and Edge.

**Local web server** (recommended, behaves exactly like IIS):

```bash
py -m http.server 8642
```

Then open http://localhost:8642.

**IIS**

1. Copy the folder (or point a site / virtual directory at it).
2. In IIS Manager: *Sites → Add Website*, physical path = this folder, any port.
3. `web.config` already sets `index.html` as the default document and the MIME types.
   No ASP.NET or other modules are needed. The app pool can be "No Managed Code".

## Where is my work saved?

- Automatically, in the browser (IndexedDB). See **Open** for all saved patterns. This storage is per browser and per site address.
- **Save file** downloads a `.stitch.json` project file. Use it for backups or to move patterns to another computer or browser. **Load file** opens one.

## Features

- **Crafts:** cross stitch (fabric count, over 1 or 2), knitting (stitch/row gauge → correct cell shape), crochet, diamond painting (round or square drills), beading (loom, peyote, brick).
- **Stitch types:** full (filled square), cross (drawn as an ✕), half (/ and \), quarter, three-quarter, backstitch, French knots and beads. Knitting and crochet also get chart symbols (knit, purl, yarn over, k2tog, ssk, chain, sc, dc, …).
- **Tools:** pencil, eraser (choose which layer to erase), fill (connected or all matching), line, rectangle, ellipse (outline or filled, Shift to constrain), colour picker, select / move / copy / cut / paste / flip / rotate / crop, text (pixel font, scale, spacing, bold), mirror drawing (left-right, top-bottom, four-way), brush size 1–30 (square or round), undo / redo.
- **Colours:** click the current colour to open the colour list. DMC (456) and Anchor (420) thread libraries with search, custom colours, editable chart symbols, replace a colour, match the whole palette to a brand, remove unused, sort, highlight one colour.
- **Grid:** any size up to 1000 × 1000, resize from any anchor, major lines every N, centre lines, rulers, configurable colours, finished size in cm or inches.
- **Views:** colour blocks, colour + symbols, black-and-white symbols, realistic stitches.
- **Image import:** resize, brightness / contrast / saturation, max colours, DMC / Anchor / any colour / current palette, optional dithering, background removal, merge rarely used colours.
- **Export:** PNG (any cell size, optional grid / rulers / transparent background), and printable charts (cover page, colour key with stitch counts and skein estimate, multi-page chart with overlap). Use *Save as PDF* in the print window to get a PDF.

Press **Help** in the app for all keyboard shortcuts.

## Stitch counter (`counter.html`)

A separate page for counting while you stitch. Open it from the **Counter** button in the editor, or go straight to `counter.html`.

- Any number of counters (stitches, rows, repeats, rounds, …), each with its own name, colour and step size, and its own **keyboard key for counting up and down**. Any key works, including USB foot pedals or clickers that act as a keyboard.
- **Targets:** signal and keep counting, stop at the target, or **roll over**: reset and add 1 to another counter (for example 40 stitches → +1 row).
- Undo (Ctrl+Z or your own key), history log, session timer with counting speed, notes.
- **Projects:** each project has its own set of counters.
- Settings: click sound, target sound, vibration, hold a key to keep counting, tap a card to count, keep the screen on, counter size, full screen.
- Everything is saved in the browser.

### Following a pattern
There are three ways to start:
- In the editor, click **Stitch it ▸ Counter**. The counter opens with that pattern already loaded.
- On the counter page, click one of your patterns in the **Follow a pattern** panel.
- On the counter page, click **Import pattern file…** and choose a `.stitch.json` file (for example from the `samples` folder).

**Pattern & order…** changes the pattern, the stitching order and the keys.

- The chart appears next to the counters. The **current stitch** is outlined, the rest of that colour run is dashed, and finished stitches fade out, get crossed out, or disappear (your choice).
- **Next stitch / Back / Finish row** each have their own key (defaults: Space, Backspace, Enter). You can change or clear each one.
- **Stitching orders:** rows (choose start corner, direction and back-and-forth), columns, diagonal (C2C), blocks (parking method: colour by colour per block), one colour at a time, or free. There are quick choices for knitting, knitting in the round, C2C, peyote and cross stitch.
- Shows the colour, column / row, "row 5 of 60 · stitch 12 of 40", and **what comes next** ("3 × red → 5 × blue"). A sound and a message play when the colour changes.
- Counters can **count along**: +1 per stitch, +1 per finished row / block, and the stitch counter can start again at each row.
- Chart tools: *Jump here*, *Mark done* / *Unmark* (click or drag; backstitches, knots and beads are ticked off the same way), *Move view*, *Focus* (darkens everything except the current row / block), *Follow*, zoom.
- Progress: % done, progress per colour, speed and estimated time left, and confetti when you finish.
- Progress is saved per pattern. In the editor, **View → Stitching progress** fades finished stitches, and the Pattern panel shows "% stitched". Both pages update each other live when they're open in two tabs.

## Project layout

```
index.html        page layout and dialogs
css/app.css       styling (light and dark theme)
js/util.js        colour maths, helpers
js/threads.js     DMC and Anchor thread colours
js/crafts.js      craft definitions, chart symbols, knit/crochet marks
js/font.js        pixel font for the text tool
js/pattern.js     pattern data model
js/history.js     undo / redo
js/renderer.js    canvas drawing
js/tools.js       drawing tools
js/importer.js    image → pattern conversion
js/exporter.js    PNG export and printing
js/storage.js     browser storage
js/ui.js          panels and dialogs
js/app.js         application controller
```

## Credits

Thread colour values come from the palettes of [Ink/Stitch](https://github.com/inkstitch/inkstitch) (GPL-3.0).
Screen colours only approximate real threads.
