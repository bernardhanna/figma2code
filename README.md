# figma2wp Starter v3 — AI Exact-Replica Export
Figma → **AI Tailwind HTML** → ACF + Frontend PHP (Flexi) → Browser preview. Includes **Theme Folder picker** and image upload. The AI pass generates a per-section HTML fragment to closely replicate your Figma section.

## What’s new in v3
- **AI codegen step** (`generator/ai/generateSection.js`) that turns Figma AST into Tailwind HTML.
- Templates accept a **fragment** so your PHP renders the AI-generated HTML inside your Flexi wrapper.
- Same rules: `get_sub_field()` only, heading tag stays as ACF option, no `min-w-[240px]` or any `aspect-[...]`, no design fields.

---

## Folder tree
```
figma2wp/
  generator/
    package.json
    server.js
    config.json             # created after you set Theme Folder
    ai/
      generateSection.js
    templates/
      acf.php.js
      frontend.php.js
      preview.html.js
  plugin/
    manifest.json
    code.ts
    ui.html
    package.json
    tsconfig.json
  theme/                    # fallback dev theme path (until you set your real one)
    acf-fields/partials/blocks/
    template-parts/flexi/
    template-parts/navbar/
    template-parts/footer/
  .preview/                 # HTML previews + /assets (uploaded images)
```

---

## 1) Generator — install & run
```bash
cd figma2wp/generator
npm i
# provide your LLM key (OpenAI shown here)
export OPENAI_API_KEY=YOUR_KEY
node server.js
```

Open **http://localhost:5173/** and set your **Theme Folder**, e.g.
```
/Users/bernardhanna/Local Sites/whitneymoore/app/public/wp-content/themes/matrix-starter
```

> CLI alternative:
```bash
curl -X POST http://localhost:5173/api/config   -H "Content-Type: application/json"   -d '{"themeRoot":"/ABSOLUTE/PATH/TO/YOUR/THEME"}'
```

---

## 2) Plugin — build & import in Figma
```bash
cd ../plugin
npm i
npx tsc
# Figma Desktop → Plugins → Development → Import plugin from manifest…
# pick: figma2wp/plugin/manifest.json
```

The plugin UI: enter **slug** and click **Export**. Use **Set Theme Folder** to open the generator home in your browser.

---

## 3) Export flow
1. In Figma, select a **single Frame** of your section.
2. Run the plugin → enter a **slug** → **Export**.
3. The generator will:
   - Run AI to produce a Tailwind **HTML fragment** for this section
   - Emit:
     - `acf-fields/partials/blocks/acf_{slug}.php`
     - `template-parts/flexi/{slug}.php`
   - Create a **preview** at `/preview/{slug}`
4. Open the preview URL; confirm fidelity.

---

## 4) WordPress wiring (once)
Load ACF groups from `acf-fields/partials/blocks/*.php`, e.g. in `functions.php`:
```php
$dir = get_stylesheet_directory() . '/acf-fields/partials/blocks';
foreach (glob($dir . '/*.php') as $file) {
    include_once $file;
}
```

---

## 5) Troubleshooting & tips
- **Cannot GET /** → ensure `node server.js` is running; open `http://localhost:5173/`.
- **Plugin “editor type dev”** → manifest includes `"figma","dev"`. Or disable Dev Mode.
- **No AI key** → set `OPENAI_API_KEY`. You can also stub the AI (see `generateSection.js` comment).
- **Exactness** → increase model quality or implement a visual diff loop with Playwright + pixelmatch (optional enhancement).
