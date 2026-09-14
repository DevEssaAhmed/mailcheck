# Validation

- Python backend: 11 tests passed (request validation, origin/host protection, Codespaces hostname configuration, result parsing, timeout/error classification, shell-free process invocation).
- Frontend JavaScript: Node syntax check passed.
- Official Reacher v0.11.7 asset installed and executed successfully. The upstream CLI reports version 0.11.6.
- Real native check for test@example.invalid returned invalid, with the expected structured fields.
- Codespaces JSON configuration validated; the app has not been launched in the user’s actual Codespace. Outbound SMTP capability is unverified there.
- Browser visual QA could not be performed because the available browser blocked the local preview address.
- Windows/WSL and macOS launch paths are provided but were not executed in this Linux environment.
