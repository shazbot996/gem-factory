# Response: 2026-04-15T09:28:11.003086

I found three root causes. First, force removing the Drive viewer DOM was corrupting Angular's internal state, preventing it from opening new viewers for subsequent files. Second, setting pointer events none was blocking our own close button clicks. Third, re-opening the overlay was overwriting stored data without merging in previously captured links. The fix never removes DOM elements, uses Escape key and close button with restored styles to close the viewer naturally, and merges stored drive links back in when the overlay reopens.
