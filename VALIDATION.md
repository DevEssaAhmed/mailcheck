# Validation

- Python backend: 15 tests passed (request validation, origin/host protection, Codespaces hostname configuration, result parsing, timeout/error classification, shell-free process invocation).
- Frontend JavaScript: Node syntax check passed.
- Official Reacher v0.11.7 asset installed and executed successfully. The upstream CLI reports version 0.11.6.
- Real native check for test@example.invalid returned invalid, with the expected structured fields.
- Codespaces JSON configuration validated; the app has not been launched in the user’s actual Codespace. Outbound SMTP capability is unverified there.
- Browser visual QA could not be performed because the available browser blocked the local preview address.
- Windows/WSL and macOS launch paths are provided but were not executed in this Linux environment.

- Session-refresh regression: frontend fetch sequence verified with mocked responses, including a single retry after the server rotates its token.
- Forwarded same-origin request accepted; cross-site/same-site requests, stale tokens, and untrusted hosts remain rejected.
- Favicon SVG and legacy icon routes verified. The fix has not yet been exercised in the user’s live Codespace.
