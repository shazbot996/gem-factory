# Response: 2026-04-15T08:50:12.483753

I removed the redundant blue plus buttons from the native gem editor and reworked the overlay so each knowledge document now has a Capture Link button. When you click it, the extension opens the Drive viewer, automatically grabs the Google Drive file ID from a hidden element in the viewer, builds a proper Drive URL, and saves it to storage so it appears in the exported JSON alongside the file name and type.
