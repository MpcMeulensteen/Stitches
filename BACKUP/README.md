# Stitch Pattern Studio

A browser app for designing stitch patterns: cross stitch, knitting colourwork, crochet (tapestry / C2C), diamond painting and beading.
It is a plain static website (HTML, CSS and JavaScript). There is no build step and no server code.

## Running it

**Quick start:** double-click `index.html`. This works in Chrome and Edge.

**Windows service on port 3001** (recommended: starts automatically with Windows, set up like The Pawcket Pile):

Needs [Node.js](https://nodejs.org). In an **Administrator** terminal in this folder:

```bash
npm install
node scripts/install-service.js
```

Then open http://localhost:3001 (other devices on your network: `http://<this-PC's-IP>:3001`).
The service is called *Stitch Pattern Studio* in `services.msc`; its logs are in `server/daemon`.
To remove it: `node scripts/uninstall-service.js` (also as Administrator).
To run it just once without the service: `npm start`.

**IIS**

1. Copy the folder (or point a site / virtual directory at it).
2. In IIS Manager: *Sites → Add Website*, physical path = this folder, any port.
3. `web.config` already sets `index.html` as the default document and the MIME types.
   No ASP.NET or other modules are needed. The app pool can be "No Managed Code".

## Importing from Excel

**Import Excel** makes a pattern from the fill colours of spreadsheet cells (filled with the paint bucket):

1. Choose an `.xlsx` file and the tab, or copy cells in Excel (Ctrl+C) and press Ctrl+V in the editor.
2. The filled cells are selected automatically; drag over the preview or type a range (e.g. `B2:BI55`) to change it.
3. *Create pattern* makes a new pattern exactly the size of the range. Every filled cell becomes a full stitch in exactly that colour; cells without a fill stay empty. Use *Match to brand…* to turn the colours into DMC or Anchor threads.

Theme colours with lighter / darker shades are read the same way Excel shows them. Old `.xls` files must be saved as `.xlsx` first.

## Profiles

Several people can use the app in the same browser: pick your name in the 👤 dropdown at the top of the editor or the counter. Each profile has its own patterns, counters, projects, stitching progress and settings. The app remembers the last profile used. The dropdown also has *New profile*, *Rename* and *Delete* (which removes everything of that profile).

Profiles are not protected; they just keep your work apart. Data that existed before profiles were added belongs to the first profile.

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

- The chart appears next to the counters. The **current stitch** is outlined, the rest of that colour run is dashed. By default finished stitches are in full colour and the rest is faded, so you see your work grow. You can switch to fading, crossing out or hiding the finished stitches instead.
- **Next stitch / Back / Finish row** each have their own key (defaults: Space, Backspace, Enter). You can change or clear each one.
- **Stitching orders:** rows (choose start corner, direction and back-and-forth), columns, diagonal (C2C), blocks (parking method: colour by colour per block), one colour at a time, or free. There are quick choices for knitting, knitting in the round, C2C, peyote and cross stitch.
- Shows the colour, column / row, "row 5 of 60 · stitch 12 of 40", and **what comes next** ("3 × red → 5 × blue"). A sound and a message play when the colour changes.
- Counters can **count along**: +1 per stitch, +1 per finished row / block, and the stitch counter can start again at each row.
- Chart tools: *Jump here*, *Mark done* / *Unmark* (click or drag; backstitches, knots and beads are ticked off the same way), *Move view*, *Focus* (darkens everything except the current row / block), *Follow*, zoom.
- Progress: % done, progress per colour, speed and estimated time left, and confetti when you finish.
- Progress is saved per pattern. In the editor, **View → Stitching progress** fades finished stitches, and the Pattern panel shows "% stitched". Both pages update each other live when they're open in two tabs.

### Sessions and time record

The **Session** box in the counter times your stitching. A session starts with your first stitch (or **Start**); **Pause** / **Resume** (key **P**, changeable in Settings) stops and continues the clock. Every session is kept in a time record with its date, active time and number of stitches, so the next time you see how long the pattern took so far. The record is saved with the pattern's progress, shown in the editor's Pattern panel, and included in **Save file** (the `stitching` part of the `.stitch.json`); **Load file** brings it back.

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
js/xlsx.js        Excel import (cell fill colours from .xlsx files and pasted cells)
js/exporter.js    PNG export and printing
js/storage.js     browser storage
js/ui.js          panels and dialogs
js/app.js         application controller
server/server.js  local web server (port 3001)
scripts/          install / uninstall the Windows service
```

## Credits

Thread colour values come from the palettes of [Ink/Stitch](https://github.com/inkstitch/inkstitch) (GPL-3.0).
Screen colours only approximate real threads.
