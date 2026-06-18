# Response: 2026-06-18T08:44:01.412141

I added a configurable alert banner to the Chrome extension that displays at the top of every public Gemini page, directing users to their private Gemini Enterprise instance. The new banner-config.js file lets administrators toggle the banner on or off and customize the color, message, and link. The banner is injected into the document root so it survives Gemini's single-page-app navigation.
