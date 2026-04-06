# Response: 2026-04-05T14:02:56.271255

WSL2 uses network address translation which blocks the multicast traffic needed for Chromecast discovery. The best fix is to enable mirrored networking mode in your WSL config file, which shares your host PC's network interfaces directly and lets multicast work. Just add networking mode equals mirrored to your dot wslconfig file and restart WSL.
