# Response: 2026-06-09T09:04:27.723162

The toolbar icon was being distorted because Chrome was stretching the landscape logo into square slots. I generated proper square sixteen, forty eight, and one twenty eight pixel PNGs with the logo letterboxed and centered on transparent backgrounds, then pointed the manifest at those new files. The floating button still uses the full logo since it already handles aspect ratio in CSS.
