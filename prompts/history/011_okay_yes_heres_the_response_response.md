# Response: 2026-04-05T12:31:40.925037

I rewrote the response parser to fix two problems. First, I replaced the fragile byte-count based chunk parsing with a simple approach that tries to parse each line as JSON directly. Second, I added a smart search for the gem list within the inner payload instead of hardcoding the array position. Reload the extension and try again.
