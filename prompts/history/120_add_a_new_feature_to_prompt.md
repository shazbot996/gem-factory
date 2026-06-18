# Executed: 2026-06-18T08:42:03.046787

Add a new feature to the Chrome extension in the `extension/` folder.

**Current behavior:** The extension only activates on gem edit pages — when a user clicks Edit on a configured gem, a small overlay with the Schnucks logo appears in the bottom-right corner.

**New feature:** Add a configurable banner that displays at the very top of the screen on the public Gemini application (`https://gemini.google.com/`) at all times. The banner should alert the user that they are currently using the public Gemini application and offer a link to redirect them to their private internal Gemini Enterprise instance.

**Context:** This extension is exclusively used by corporate employees who are being encouraged to use their private corporate Gemini Enterprise instance instead of the public `gemini.google.com`.

**Configuration requirements:** Create a configuration file in the `extension/` folder that allows an administrator to configure:

- An enable/disable toggle for the banner (so it can be easily turned on or off at will)
- The banner color
- The message content
- The URL link to the private Gemini Enterprise instance
