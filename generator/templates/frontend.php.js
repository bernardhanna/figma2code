export function frontendPhp(ast, opts = {}) {
  const classes = ast.content?.classes || {};
  const sanitizedOuter = (classes.outer || "")
    .replace(/\bflex\b/g, "")
    .replace(/\bflex-col\b/g, "")
    .replace(/\bflex-row\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let fragment = (opts.fragment || "").trim();

  const slotHeadingPHP = `
<?php if (!empty($heading_text)) : ?>
  <<?php echo esc_attr($heading_tag); ?> class="font-semibold leading-tight tracking-tight">
    <?php echo esc_html($heading_text); ?>
  </<?php echo esc_attr($heading_tag); ?>>
<?php endif; ?>`.trim();

  const slotSubcopyPHP = `
<?php if (!empty($subcopy)) : ?>
  <div class="wp_editor">
    <?php echo wp_kses_post($subcopy); ?>
  </div>
<?php endif; ?>`.trim();

  const slotImagePHP = `
<?php if (!empty($img_url)) : ?>
  <img
    class="<?php echo esc_attr($image_radius ? $image_radius : 'rounded-none'); ?> block h-auto w-full"
    src="<?php echo esc_url($img_url); ?>"
    alt="<?php echo esc_attr($img_alt); ?>"
    title="<?php echo esc_attr($img_title); ?>"
    loading="lazy"
    decoding="async"
  />
<?php endif; ?>`.trim();

  fragment = fragment
    .replace("<!--SLOT:heading-->", slotHeadingPHP)
    .replace("<!--SLOT:subcopy-->", slotSubcopyPHP)
    .replace("<!--SLOT:image_main-->", slotImagePHP);

  return `<?php
$section_id    = 'sec-' . wp_generate_password(8, false, false);
$section_label = get_sub_field('section_label');

$heading_text = get_sub_field('heading_text');
$heading_tag  = get_sub_field('heading_tag');
$subcopy      = get_sub_field('subcopy');

$image_field  = get_sub_field('image');
$image_radius = get_sub_field('image_radius');
$primary_cta  = null;

$padding_classes = array('pt-5', 'pb-5');
if (have_rows('padding_settings')) {
    while (have_rows('padding_settings')) {
        the_row();
        $screen_size    = get_sub_field('screen_size');
        $padding_top    = get_sub_field('padding_top');
        $padding_bottom = get_sub_field('padding_bottom');
        if ($screen_size !== '' && $padding_top !== null && $padding_top !== '') {
            $padding_classes[] = esc_attr("{$screen_size}:pt-[{$padding_top}rem]");
        }
        if ($screen_size !== '' && $padding_bottom !== null && $padding_bottom !== '') {
            $padding_classes[] = esc_attr("{$screen_size}:pb-[{$padding_bottom}rem]");
        }
    }
}

$allowed_tags = array('h1','h2','h3','h4','h5','h6','span','p');
if (!in_array($heading_tag, $allowed_tags, true)) { $heading_tag = 'h2'; }

$img_url = $img_alt = $img_title = '';
if (is_array($image_field)) {
    $img_url   = isset($image_field['url']) ? $image_field['url'] : '';
    $img_alt   = isset($image_field['alt']) ? $image_field['alt'] : '';
    $img_title = isset($image_field['title']) ? $image_field['title'] : '';
}
if ($img_alt === '')   { $img_alt = $heading_text ? $heading_text : 'Image'; }
if ($img_title === '') { $img_title = 'Image'; }

$inner_base = 'flex flex-col items-center w-full mx-auto max-w-container max-lg:px-5';
$inner_classes = trim($inner_base . ' ' . '${sanitizedOuter}' . ' ' . implode(' ', $padding_classes));
?>
<section id="<?php echo esc_attr($section_id); ?>" class="relative flex overflow-hidden">
  <div class="<?php echo esc_attr($inner_classes); ?>">
    <?php /* BEGIN AI FRAGMENT with SLOTs replaced by PHP */ ?>
    ${fragment}
    <?php /* END AI FRAGMENT */ ?>
  </div>
</section>
`;
}
