const test = require("node:test");
const assert = require("node:assert/strict");

const { apply } = require("../output/sanitize/removePreviewScripts");

test("output HTML containing Tailwind CDN bootstrap => removed", () => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Test</title></head>
    <body>
    <div class="container">Content</div>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      window.tailwind.config = { theme: { extend: {} } };
    </script>
    </body>
    </html>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("cdn.tailwindcss.com"));
  assert.ok(!out.html.includes("window.tailwind.config"));
  assert.ok(out.html.includes("Content"));
  assert.ok(out.stats.removed >= 1);
});

test("NiceSelect CDN loader => removed", () => {
  const html = `
    <body>
    <select class="form-select"></select>
    <script>
      (function(){ var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/nice-select2@2.0.0/dist/js/nice-select2.js'; document.head.appendChild(s); })();
    </script>
    </body>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("nice-select2"));
  assert.ok(out.html.includes("<select"));
  assert.equal(out.stats.removed, 1);
});

test("video injection helper => removed", () => {
  const html = `
    <body>
    <div data-bg-type="video">Hero</div>
    <script>
      (function videoPreviewReady() {
        document.querySelectorAll('[data-bg-type="video"], [data-fill-type="video"]').forEach(function(el){});
      })();
    </script>
    </body>
  `;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(!out.html.includes("videoPreviewReady"));
  assert.ok(out.html.includes("data-bg-type"), "markup with data-bg-type preserved");
  assert.equal(out.stats.removed, 1);
});

test("legitimate inline script is untouched", () => {
  const html = `<body><script>console.log('hello');</script></body>`;
  const out = apply({ html, artifact: {}, options: {} });
  assert.ok(out.html.includes("console.log"));
  assert.equal(out.stats.removed, 0);
});
