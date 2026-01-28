// generator/export/index.js
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { PREVIEW_DIR, ROOT as GENERATOR_ROOT, VDIFF_DIR } from "../server/runtimePaths.js";
import { groupDir } from "../server/variantStore.js";
import { getAttrValue, parseHtmlNodes } from "../contracts/contractTypes.js";

const EXPORT_DEBUG = String(process.env.EXPORT_DEBUG || "").trim() === "1";

function logDebug(...args) {
  if (EXPORT_DEBUG) console.log("[export]", ...args);
}

function decodeSrcdocAttr(value) {
  // Decode only what preview.html.js encodes via escapeAttr().
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractPreviewFragment(previewHtml) {
  const html = String(previewHtml || "");
  if (!html) return "";

  const iframeMatch =
    html.match(/<iframe[^>]*\bsrcdoc="([\s\S]*?)"/i) ||
    html.match(/<iframe[^>]*\bsrcdoc='([\s\S]*?)'/i);

  if (!iframeMatch) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? String(bodyMatch[1] || "").trim() : html.trim();
  }

  const srcdocEscaped = iframeMatch[1] || "";
  const srcdoc = decodeSrcdocAttr(srcdocEscaped);
  const bodyMatch = srcdoc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? String(bodyMatch[1] || "").trim() : srcdoc.trim();
}

export function selectRootFragment(fragmentHtml) {
  const html = String(fragmentHtml || "");
  if (!html) return "";
  const nodes = parseHtmlNodes(html);
  const root = nodes.find((node) => getAttrValue(node.attrs, "data-key") === "root");
  if (!root || root.openStart == null || root.end == null) return html.trim();
  return html.slice(root.openStart, root.end).trim();
}

function stripDebugDataAttrs(html) {
  return String(html || "").replace(
    /\sdata-(?!key\b)[a-z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,
    ""
  );
}

function sanitizeClassAttrValue(value) {
  const tokens = String(value || "")
    .split(/\s+/g)
    .filter(Boolean)
    .filter((token) => {
      const t = String(token || "");
      if (t.includes("min-w-[240px]")) return false;
      if (/(^|:)aspect-/.test(t)) return false;
      return true;
    });

  return tokens.join(" ");
}

function stripUnwantedClasses(html) {
  return String(html || "").replace(/\bclass\s*=\s*(["'])([\s\S]*?)\1/g, (match, quote, cls) => {
    const cleaned = sanitizeClassAttrValue(cls);
    if (!cleaned) return "";
    return `class=${quote}${cleaned}${quote}`;
  });
}

export function sanitizePreviewHtml(html) {
  const strippedAttrs = stripDebugDataAttrs(html);
  const strippedClasses = stripUnwantedClasses(strippedAttrs);
  return String(strippedClasses || "").trim();
}

export function getNextComponentId(typeDir) {
  if (!typeDir) return "001";
  if (!fs.existsSync(typeDir)) return "001";

  const entries = fs.readdirSync(typeDir, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((n) => Number.isFinite(n));

  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  return String(next).padStart(3, "0");
}

function resolveComponentsRoot(componentsRoot) {
  const repoRoot = path.resolve(GENERATOR_ROOT, "..");
  if (!componentsRoot) return path.resolve(repoRoot, "components");
  return path.isAbsolute(componentsRoot)
    ? componentsRoot
    : path.resolve(repoRoot, componentsRoot);
}

function titleCase(input) {
  return String(input || "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function indentHtml(html, spaces = 4) {
  const pad = " ".repeat(spaces);
  return String(html || "")
    .split(/\r?\n/g)
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join("\n");
}

export function writeHeroPhp({ outputDir, componentBaseName, type, sanitizedHtml }) {
  const prefix = String(type || "section").trim() || "section";
  const sanitized = indentHtml(sanitizedHtml || "", 4);
  const php = `<?php
$heading_text = get_sub_field('heading_text');
$heading_tag = get_sub_field('heading_tag');
$body_content = get_sub_field('body_content');
$primary_link = get_sub_field('primary_link');
$show_primary_link = get_sub_field('show_primary_link');

$padding_classes = [];
if (have_rows('padding_settings')) {
  while (have_rows('padding_settings')) {
    the_row();
    $screen_size = get_sub_field('screen_size');
    $padding_top = get_sub_field('padding_top');
    $padding_bottom = get_sub_field('padding_bottom');
    $padding_classes[] = "{$screen_size}:pt-[{$padding_top}rem]";
    $padding_classes[] = "{$screen_size}:pb-[{$padding_bottom}rem]";
  }
}

$section_id = '${prefix}-' . wp_generate_uuid4();
$allowed_heading_tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'p'];
$heading_tag = in_array($heading_tag, $allowed_heading_tags, true) ? $heading_tag : 'h2';
?>

<section id="<?php echo esc_attr($section_id); ?>" class="relative flex overflow-hidden">
  <div class="flex flex-col items-center w-full mx-auto max-w-container pt-5 pb-5 max-lg:px-5 <?php echo esc_attr(implode(' ', $padding_classes)); ?>">
    <div class="w-full max-w-[900px]">
      <?php if (!empty($heading_text)) : ?>
        <<?php echo esc_attr($heading_tag); ?> class="text-3xl font-semibold leading-tight">
          <?php echo esc_html($heading_text); ?>
        </<?php echo esc_attr($heading_tag); ?>>
      <?php endif; ?>

      <?php if (!empty($body_content)) : ?>
        <div class="mt-4 text-base leading-6 text-neutral-700 wp_editor">
          <?php echo wp_kses_post($body_content); ?>
        </div>
      <?php endif; ?>

      <?php if ($show_primary_link && !empty($primary_link['url'])) : ?>
        <a
          href="<?php echo esc_url($primary_link['url']); ?>"
          target="<?php echo esc_attr($primary_link['target'] ?: '_self'); ?>"
          class="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-white"
        >
          <?php echo esc_html($primary_link['title'] ?: 'Learn more'); ?>
        </a>
      <?php endif; ?>
    </div>

    <!-- Static layout fallback (from preview) -->
${sanitized}
    <!-- End static layout fallback -->
  </div>
</section>
`;

  const outPath = path.join(outputDir, `${componentBaseName}.php`);
  fs.writeFileSync(outPath, php, "utf8");
  return outPath;
}

export function writeAcfHeroPhp({ outputDir, componentBaseName, type, id }) {
  const label = `${titleCase(type)} ${id}`;
  const acf = `<?php

use StoutLogic\\AcfBuilder\\FieldsBuilder;

$${componentBaseName} = new FieldsBuilder('${componentBaseName}', [
  'label' => '${label}',
]);

$${componentBaseName}
  ->addTab('Content', ['label' => 'Content'])
  ->addText('heading_text', [
    'label' => 'Heading Text',
    'instructions' => 'Enter the main heading text.',
    'default_value' => 'Your heading here',
  ])
  ->addSelect('heading_tag', [
    'label' => 'Heading Tag',
    'instructions' => 'Select the HTML heading tag.',
    'choices' => [
      'h1' => 'H1',
      'h2' => 'H2',
      'h3' => 'H3',
      'h4' => 'H4',
      'h5' => 'H5',
      'h6' => 'H6',
      'span' => 'Span',
      'p' => 'Paragraph',
    ],
    'default_value' => 'h2',
  ])
  ->addWysiwyg('body_content', [
    'label' => 'Body Content',
    'instructions' => 'Enter the body content.',
    'default_value' => 'Lorem ipsum dolor sit amet.',
    'media_upload' => 0,
    'tabs' => 'all',
    'toolbar' => 'full',
  ])
  ->addTrueFalse('show_primary_link', [
    'label' => 'Show Primary Link',
    'instructions' => 'Toggle the primary link on/off.',
    'default_value' => 1,
    'ui' => 1,
  ])
  ->addLink('primary_link', [
    'label' => 'Primary Link',
    'instructions' => 'Add the primary CTA link.',
    'return_format' => 'array',
  ])
  ->addTab('Layout', ['label' => 'Layout'])
  ->addRepeater('padding_settings', [
    'label' => 'Padding Settings',
    'instructions' => 'Customize padding for different screen sizes.',
    'button_label' => 'Add Screen Size Padding',
  ])
  ->addSelect('screen_size', [
    'label' => 'Screen Size',
    'choices' => [
      'xxs' => 'xxs',
      'xs' => 'xs',
      'mob' => 'mob',
      'sm' => 'sm',
      'md' => 'md',
      'lg' => 'lg',
      'xl' => 'xl',
      'xxl' => 'xxl',
      'ultrawide' => 'ultrawide',
    ],
  ])
  ->addNumber('padding_top', [
    'label' => 'Padding Top',
    'instructions' => 'Set the top padding in rem.',
    'min' => 0,
    'max' => 20,
    'step' => 0.1,
    'append' => 'rem',
  ])
  ->addNumber('padding_bottom', [
    'label' => 'Padding Bottom',
    'instructions' => 'Set the bottom padding in rem.',
    'min' => 0,
    'max' => 20,
    'step' => 0.1,
    'append' => 'rem',
  ])
  ->endRepeater();

return $${componentBaseName};
`;

  const outPath = path.join(outputDir, `acf_${componentBaseName}.php`);
  fs.writeFileSync(outPath, acf, "utf8");
  return outPath;
}

function resolveOverlayDir(slug) {
  const canonical = groupDir(slug);
  if (fs.existsSync(canonical)) return canonical;
  const legacy = path.join(VDIFF_DIR, String(slug || "").trim());
  if (fs.existsSync(legacy)) return legacy;
  return canonical;
}

function findOverlaySources(slug) {
  const dir = resolveOverlayDir(slug);
  const pickFirst = (names) => {
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    return "";
  };

  const variants = {
    desktop: pickFirst(["figma.desktop.png", "desktop.png"]),
    tablet: pickFirst(["figma.tablet.png", "tablet.png"]),
    mobile: pickFirst(["figma.mobile.png", "mobile.png"]),
  };

  const single = pickFirst(["figma.png"]);

  return { dir, variants, single };
}

export function copyOverlayImages({ slug, destDir, componentBaseName }) {
  const { variants, single } = findOverlaySources(slug);
  const variantEntries = Object.entries(variants).filter(([, src]) => !!src);
  if (!variantEntries.length && !single) return [];

  const output = [];
  const hasVariants = variantEntries.length >= 1;

  if (hasVariants) {
    for (const [variant, src] of variantEntries) {
      const outPath = path.join(destDir, `${variant}.png`);
      fs.copyFileSync(src, outPath);
      output.push(outPath);
    }
  } else {
    const src = single;
    const baseName = `${componentBaseName || "component"}.png`;
    const outPath = path.join(destDir, baseName);
    fs.copyFileSync(src, outPath);
    output.push(outPath);
  }

  logDebug(`Copied ${output.length} overlay image(s).`);
  return output;
}

export async function exportComponent({ slug, type, componentsRoot, fragmentHtml }) {
  const safeSlug = String(slug || "").trim();
  const safeType = String(type || "").trim();

  if (!safeSlug) throw new Error("exportComponent: missing slug");
  if (!safeType) throw new Error("exportComponent: missing type");

  const previewPath = path.join(PREVIEW_DIR, `${safeSlug}.html`);
  let previewHtml = "";

  if (!fragmentHtml) {
    if (!fs.existsSync(previewPath)) {
      throw new Error(`Preview not found for slug "${safeSlug}" (${previewPath})`);
    }
    previewHtml = fs.readFileSync(previewPath, "utf8");
  }

  const fragmentSource = fragmentHtml ? String(fragmentHtml || "") : extractPreviewFragment(previewHtml);
  const rootFragment = selectRootFragment(fragmentSource);
  const sanitizedHtml = sanitizePreviewHtml(rootFragment);

  const componentsBase = resolveComponentsRoot(componentsRoot);
  const typeDir = path.join(componentsBase, safeType);
  fs.mkdirSync(typeDir, { recursive: true });

  const id = getNextComponentId(typeDir);
  const componentBaseName = `${safeType}_${id}`;
  const outputDir = path.join(typeDir, id);
  fs.mkdirSync(outputDir, { recursive: true });

  logDebug(`Exporting ${componentBaseName} to ${outputDir}`);

  const heroPath = writeHeroPhp({
    outputDir,
    componentBaseName,
    type: safeType,
    sanitizedHtml,
  });

  const acfPath = writeAcfHeroPhp({
    outputDir,
    componentBaseName,
    type: safeType,
    id,
  });

  const imagePaths = copyOverlayImages({
    slug: safeSlug,
    destDir: outputDir,
    componentBaseName,
  });

  const files = [heroPath, acfPath, ...imagePaths];

  logDebug(`Generated files:`, files);

  return {
    ok: true,
    type: safeType,
    id,
    folder: outputDir,
    files,
  };
}

