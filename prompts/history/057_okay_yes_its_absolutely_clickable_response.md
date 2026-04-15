# Response: 2026-04-15T08:38:07.224971

Great findings from the HTML analysis. When you click a knowledge file, it opens a Google Drive viewer overlay that contains a hidden div with the document's Drive ID, title, and mime type as structured JSON. We can't read the actual document content because it's in a cross-origin iframe, but we can capture the Drive file IDs. I'd recommend a user-assisted workflow where after the main gem capture, the user clicks each knowledge file to view it, and the extension automatically harvests the Drive ID in the background using a MutationObserver.
