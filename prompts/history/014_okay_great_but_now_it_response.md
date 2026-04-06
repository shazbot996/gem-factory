# Response: 2026-04-05T12:45:28.830120

I found the working gemini web API Python library and compared its request format to ours. Three differences: the library sends a source-path query parameter, uses the identifier "custom" instead of "generic", and explicitly sets Origin and Referer headers. I applied all three fixes. Reload and try again.
