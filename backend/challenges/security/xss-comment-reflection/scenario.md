# Cross-Site Scripting: Comment Reflection

## Background

You're reviewing **Acme Corp's customer feedback form**. The form has a "Preview" feature that lets users see how their comment will render before submitting it. The product team enabled "light HTML formatting" so people can use `<b>`, `<i>`, etc. in their comments.

The QA team also uses the preview page as a smoke test for an unrelated feature — internal release notes — and stashes those notes in a JavaScript variable on the page.

## Your Mission

**Attack Phase**: Use the comment field to execute JavaScript on the preview page and exfiltrate the contents of `window.__INTERNAL_NOTES` — that's where the flag lives.

**Defend Phase** *(optional, after attack)*: Patch the source so user-supplied comments can't execute scripts, without breaking the page entirely.

## What You're Looking At

A small Flask app with two interesting routes — the comment form and the preview. Look at how the preview passes the user's comment through to the template; pay attention to anything that explicitly tells the templating engine "trust this string."

## Tips

- The flag is on the **preview page**, in a JS global named `__INTERNAL_NOTES`. Open DevTools and run `console.log(window.__INTERNAL_NOTES)` once you're there to confirm
- A working payload runs JavaScript when the preview page loads — try `<script>...</script>` or an event-handler attribute on a self-loading element
- Once your script runs, getting the flag onto the page is a one-liner
- A correct fix typically means letting the templating engine do its default escape, or running input through an HTML sanitizer with an allow-list
