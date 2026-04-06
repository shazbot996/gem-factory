# Executed: 2026-04-05T12:58:08.045431

The current extraction method only retrieves the first line of the gem's prompt — the summary text visible on the Gems list page (https://gemini.google.com/gems/view). It's not capturing the full prompt content.

The full prompt text is available when you open a gem for editing (e.g., https://gemini.google.com/gems/edit/ca0887e252fe) — it's displayed in an editable form/textarea with all the content.

Change the approach: instead of trying to extract from the list view, only show the gem copy icon when the user is on a gem's edit page. From that edit screen, extract the full prompt data from the form fields, since all the content is right there in the editable window. Let's do this one gem at a time rather than trying to bulk-extract from the list view.
