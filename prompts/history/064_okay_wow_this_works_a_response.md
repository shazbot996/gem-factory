# Response: 2026-04-15T09:30:36.747623

The Escape key events we were dispatching to close the Drive viewer were bubbling up to our overlay's own Escape handler, which was closing our modal. I added a guard flag that disables the overlay's Escape listener during link capture, and also scoped the fallback Escape dispatch so it doesn't bubble to the document level.
