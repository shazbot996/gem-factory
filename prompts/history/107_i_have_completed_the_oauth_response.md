# Response: 2026-05-14T10:29:43.365626

I have refactored the identity discovery logic to use the Google UserInfo API with your OAuth token, which is more reliable than the deprecated profile check. This fix bypasses the need for Chrome sync and should resolve the error you encountered during the save flow.
