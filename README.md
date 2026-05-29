# BattleTech Roster Builder

A browser-based tool for building BattleTech unit rosters and exporting them as PDFs. Hosted via GitHub Pages — no server required.

## Setup

### 1. Enable GitHub Pages

1. Go to your repository on GitHub.
2. Navigate to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**, choose **main**, and set the folder to **/ (root)**.
4. Save. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

### 2. Add mech images

Images must be organized in subfolders under `images/`. Each subfolder becomes a category.

```
images/
  Inner Sphere/
    Atlas.png
    Marauder.png
  Clan/
    Timber Wolf.png
```

Supported formats: `.png`, `.jpg`, `.jpeg`, `.webp`

### 3. Update the manifest

The app reads `manifest.json` at startup to know which images are available.

**Option A — Automatically (recommended):** Push your images to the `main` branch. The included GitHub Action (`.github/workflows/update-manifest.yml`) will regenerate `manifest.json` automatically whenever files under `images/` change.

**Option B — Manually:** Run the helper script locally, then commit the result:

```bash
python generate-manifest.py
git add manifest.json images/
git commit -m "add mech images"
git push
```

## Local testing

Open `index.html` in a browser via a local server (e.g. `python -m http.server`). Use the **Load local images** button to load a folder directly from your machine — no manifest needed.

> Note: the folder picker requires a local server or browser that supports `file://` with `webkitdirectory`. Most modern browsers work fine over `localhost`.

## Battle Value (BV)

Each roster card has a **base BV** field and shows the **skill-adjusted BV**, calculated from the pilot's Gunnery/Piloting using the official BV2 skill multiplier table (TechManual p.315). Per-group subtotals and a grand total appear in the roster header, and the adjusted BV is printed on each PDF card.

Base BV is auto-filled by matching the card's filename against a BV table. Matching is forgiving — it ignores case, punctuation, and leading collection tags (so `BTD Atlas AS7-D.png` still matches `Atlas AS7-D`).

### Loading a BV table

The bundled `bv-data.json` contains only a small starter set. For full coverage, click **Load BV table** and select a file in either format:

- **JSON** — an object mapping unit name to base BV:
  ```json
  { "Atlas AS7-D": 1897, "Marauder MAD-3R": 1363 }
  ```
- **CSV** — one unit per line, BV in the last column (a header row is fine):
  ```
  Atlas AS7-D,1897
  Marauder MAD-3R,1363
  ```

You can export such a list from the [Master Unit List](https://masterunitlist.info). To make matches permanent for everyone, paste your entries into `bv-data.json` and commit it.

If a card doesn't match, just type its base BV into the card's BV field — manual values are never overwritten by a later table import.

## PDF export

Click **Export PDF** to download a print-ready PDF of your current roster (landscape, 2×2 cards per page, letter size).
