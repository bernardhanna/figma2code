export function acfPhp(ast) {
  const esc = (s = "") => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nice = esc(
    ast.slug.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
  );
  const hasImage = !!ast.content?.image;
  const hasCTA = !!(ast.content?.ctas && ast.content.ctas.length);
  const hasItems = !!(ast.content?.items && ast.content.items.length);

  return `<?php
use StoutLogic\\AcfBuilder\\FieldsBuilder;

$${ast.slug} = new FieldsBuilder('${ast.slug}', [
    'label' => '${nice}',
]);

$${ast.slug}
    ->addTab('content_tab', ['label' => 'Content'])
        ->addText('section_label', [
            'label' => 'Admin Label',
            'instructions' => 'Internal only.',
        ])
        ->addText('heading_text', [
            'label' => 'Heading',
            'default_value' => '${esc(
              ast.content?.heading?.text || "Heading"
            )}',
        ])
        ->addSelect('heading_tag', [
            'label' => 'Heading Tag',
            'choices' => [
                'h1' => 'h1','h2' => 'h2','h3' => 'h3','h4' => 'h4','h5' => 'h5','h6' => 'h6',
                'span' => 'span','p' => 'p',
            ],
            'default_value' => 'h2',
        ])
        ->addWysiwyg('subcopy', [
            'label' => 'Subcopy',
            'media_upload' => 0,
            'tabs' => 'visual',
            'delay' => 0,
        ])
        ${
          hasImage
            ? "->addImage('image', ['label'=>'Image','return_format'=>'array','preview_size'=>'medium'])"
            : ""
        }
        ${
          hasCTA
            ? "->addLink('primary_cta', ['label'=>'Primary CTA','return_format'=>'array'])"
            : ""
        }
        ${
          hasItems
            ? "->addRepeater('items', ['label'=>'Items'])->addImage('icon',['label'=>'Icon','return_format'=>'array'])->addText('item_heading',['label'=>'Item Heading'])->addWysiwyg('item_text',['label'=>'Item Text','media_upload'=>0,'tabs'=>'visual'])->endRepeater()"
            : ""
        }

    ->addTab('layout_tab', ['label' => 'Layout'])
        ->addSelect('image_radius', [
            'label' => 'Image Border Radius',
            'choices' => [
                'rounded-none'=>'rounded-none','rounded'=>'rounded','rounded-md'=>'rounded-md',
                'rounded-lg'=>'rounded-lg','rounded-xl'=>'rounded-xl','rounded-full'=>'rounded-full',
            ],
            'default_value' => '${ast.layout?.imageRadius || "rounded-none"}',
        ])
        ->addRepeater('padding_settings', [
            'label' => 'Padding Settings',
            'instructions' => 'Customize padding for different screen sizes.',
            'button_label' => 'Add Screen Size Padding',
        ])
            ->addSelect('screen_size', [
                'label' => 'Screen Size',
                'choices' => [
                    'xxs'=>'xxs','xs'=>'xs','mob'=>'mob','sm'=>'sm','md'=>'md',
                    'lg'=>'lg','xl'=>'xl','xxl'=>'xxl','ultrawide'=>'ultrawide',
                ],
            ])
            ->addNumber('padding_top', [
                'label' => 'Padding Top',
                'instructions' => 'Set the top padding in rem.',
                'min' => 0,'max' => 20,'step' => 0.1,'append' => 'rem',
            ])
            ->addNumber('padding_bottom', [
                'label' => 'Padding Bottom',
                'instructions' => 'Set the bottom padding in rem.',
                'min' => 0,'max' => 20,'step' => 0.1,'append' => 'rem',
            ])
        ->endRepeater();

return $${ast.slug};
`;
}
