# Response: 2026-04-05T12:53:01.485075

I switched to a completely different approach for getting full instructions. Instead of trying to get them from the API, the extension now loads the gem's edit page in a hidden iframe and reads the full text directly from the Quill editor in the DOM. This is the same way the user would see the full instructions. Version is now 0.2.0, reload and try again.
