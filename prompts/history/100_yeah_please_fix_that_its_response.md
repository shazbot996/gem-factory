# Response: 2026-04-16T15:24:46.943893

Fixed. I added a check that decodes the cached token on page load, and if it is still valid we skip the Google One Tap prompt entirely and just schedule a refresh for five minutes before expiry. Reload the page and the prompt will be gone.
