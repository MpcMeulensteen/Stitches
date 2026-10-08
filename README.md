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
