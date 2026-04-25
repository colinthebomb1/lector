# Reference Summary

This is a small Flask web app — Acme Corp's customer feedback form. Users type a comment on the home page (`/`), click "Preview", and are taken to `/preview`, which echoes their comment back rendered as HTML so they can see how it will appear before submitting. The preview page also exposes a JavaScript global, `window.__INTERNAL_NOTES`, populated server-side from the app's "internal release notes" — in this challenge, that value is the flag.

## Vulnerability

The preview route wraps the comment in `Markup(...)` before passing it to the template:

```python
rendered = Markup(comment)
```

`Markup` tells Jinja "this string is already safe HTML — do not escape it." So the comment is rendered verbatim into the DOM, including any `<script>` tags or event-handler attributes the user supplies. This is reflected Cross-Site Scripting.

## Exploit

A comment containing a `<script>` tag will execute in any browser that loads the preview page. Because `window.__INTERNAL_NOTES` is exposed on the same page, the injected script can read and exfiltrate the flag:

```html
<script>document.body.innerText = window.__INTERNAL_NOTES</script>
```

When the preview renders, the script runs and replaces the page body with the flag. Alternatively, an attribute-based payload like `<img src=x onerror="document.title=window.__INTERNAL_NOTES">` works the same way.

## Fix

Remove the `Markup` wrapper so Jinja's default auto-escape applies:

```python
rendered = comment
```

Jinja will now HTML-encode `<`, `>`, `"`, `'`, and `&` on output, so a payload like `<script>...</script>` becomes the inert text `&lt;script&gt;...&lt;/script&gt;` in the page source.

If the product genuinely needs to allow a small set of formatting tags (like `<b>` or `<i>`), the safer pattern is a sanitizer with an explicit allow-list — e.g. `bleach.clean(comment, tags=["b", "i", "u"], strip=True)` — rather than trusting raw user HTML.
