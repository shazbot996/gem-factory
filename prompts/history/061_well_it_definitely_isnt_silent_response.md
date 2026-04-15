# Response: 2026-04-15T09:15:33.761451

The previous version failed because the CSS style tag injection lost the specificity battle against the Drive viewer's own styles, and we were clicking the wrong close button. This update switches to setting inline styles directly on the viewer DOM element which always wins over stylesheet rules, correctly targets the close button by its aria label attribute, and force removes the viewer from the DOM as a fallback. The viewer should now be invisible during capture and fully cleaned up afterward.
