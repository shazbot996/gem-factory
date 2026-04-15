# Response: 2026-04-15T09:11:29.327560

I reworked the capture flow so it's completely silent. When you click Capture All Links in the overlay, the extension injects CSS to hide the Drive viewer off screen, programmatically clicks each knowledge file chip to trigger the viewer in the background, grabs the Drive file ID from a hidden DOM element, then immediately closes the viewer. The user never sees it open. Each row updates live with a checkmark and the captured URL, and the Copy JSON output includes the Drive ID and URL for every document.
