# Response: 2026-04-05T14:19:19.938358

The Cast device can send volume commands but can't fetch the audio file because the Windows firewall blocks inbound connections in mirrored networking mode. I changed the cast HTTP server to use a fixed port 8099, and you need to run a PowerShell command as administrator to add a firewall rule allowing inbound traffic on that port.
