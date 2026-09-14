# Mailcheck

A personal browser app for checking email reachability with the **real Reacher CLI**, running as a native executable. No Reacher Docker container, paid API subscription, pip packages, or Node build is needed. Python 3.10+ serves the app and calls Reacher; HTML, CSS, and JavaScript provide the interface.

## Run in GitHub Codespaces

1. Open this repository on GitHub. Choose **Code → Codespaces → Create codespace on main**.
2. Wait for setup to finish. The included configuration installs Python and the official Reacher release automatically.
3. In the Codespaces terminal run:

   ```bash
   python3 app.py
   ```

4. Open **Ports → 8765 → Open in Browser** if it does not open automatically. **Keep Port Visibility set to Private** (the Codespaces default).
5. Enter an email address and choose **Check address**.

Codespaces itself uses a development container managed by GitHub. You do not install Docker or manage a Reacher container. The native executable runs inside that development environment. Keep the terminal running; stop it with Ctrl+C. Codespaces is a development environment, not permanent hosting: the app stops when the Codespace stops. Usage is subject to your GitHub allowance.

### Does mailbox verification work in Codespaces?

The UI and native engine can run there. Full SMTP mailbox verification **also requires outbound TCP port 25 and cooperation from the receiving mail server**. This package has not been tested in your actual Codespace, so that network capability is not guaranteed.

Run this diagnostic in the Codespaces terminal:

```bash
python3 diagnose.py
```

It opens a connection and reads the SMTP greeting from two public mail servers; it sends no email. Failures can mean network restrictions, destination filtering, or unavailable servers. A successful connection does not guarantee that all mailboxes can be verified. If checks stay inconclusive, use a computer or server whose provider permits outbound SMTP. Opening inbound port 25 in the Codespaces Ports panel does **not** fix outbound restrictions; ports 465/587 are not drop-in replacements for recipient verification.

## Run locally on Linux or macOS

Extract this folder, open a terminal in it, and run:

```bash
python3 setup_reacher.py
python3 app.py --open
```

Open `http://127.0.0.1:8765` if the browser does not launch. No Python dependencies need installation. Linux x86-64 uses the musl binary; Linux ARM64 uses the upstream GNU build (requires compatible system libraries). The upstream macOS release is Intel-only, so Apple Silicon requires Rosetta 2 or a source build.

## Windows

Upstream v0.11.7 does not provide a prebuilt Windows executable. Use **Codespaces** for the easiest browser-only setup, or Ubuntu through WSL:

1. Install Ubuntu in WSL with `wsl --install -d Ubuntu` in an administrator terminal if WSL is not installed. Complete Ubuntu's initial setup and restart Windows if requested.
2. Make Ubuntu your default WSL distribution if another distribution is selected.
3. Extract this folder and double-click **Start-Windows.bat**. Keep the terminal open and open `http://127.0.0.1:8765`. If the browser opens before the server is ready, refresh once the terminal displays the URL.

If the launcher fails, open the project directory in an Ubuntu terminal and run the two Python commands above. Python 3.10+ must be installed in Ubuntu.

## What you see

- Reachable, risky, invalid, or inconclusive: Reacher's classification, presented in plain language.
- Address format, domain mail support, SMTP connection, mailbox deliverability, catch-all status, and disposable-address checks.
- Expandable original Reacher JSON, including any error details.
- Missing-engine, input-validation, timeout, and execution-error states.

An **inconclusive** result does not mean an address is invalid. Mail servers can block verification. Even a reachable result is not a delivery guarantee. The app does not fabricate a positive result when the engine is missing or cannot finish.

## Configuration

Environment variables are inherited by the native CLI. Set `FROM_EMAIL` and `HELLO_NAME` to an address/domain you control when needed for valid SMTP identification. Do not put secrets in source files. See the upstream CLI documentation for supported proxy settings. This app disables optional Gravatar and breach-data enrichment.

`REACHER_BIN` may be an absolute path to your own compiled CLI executable. The installer pins upstream **release v0.11.7**; its CLI currently reports **0.11.6** because the upstream CLI package version was not bumped in that release. Setup checks GitHub's asset digest when supplied and records local SHA-256 hashes in `bin/installed.json`. The executable and local manifest are excluded from Git.

For a source build, install the Rust toolchain and the dependencies required by the upstream project:

```bash
git clone --branch v0.11.7 --depth 1 https://github.com/reacherhq/check-if-email-exists.git
cd check-if-email-exists
cargo build --release -p check-if-email-exists-cli
```

Point `REACHER_BIN` at `target/release/check_if_email_exists` before starting this app. Native build prerequisites vary by platform; prefer the supplied installer when a matching release is available.

## Privacy and scope

This is a personal development/local app, not an internet-facing production service. It listens on loopback, validates the Host and Origin, uses a per-process request token, limits request size, invokes the CLI without a shell, and runs one check at a time with a 60-second timeout. It does not log addresses or save check history. In Codespaces, only the exact forwarded hostname from the Codespaces environment is accepted; GitHub's **private port authentication** provides the access boundary. Do not make the port public. Reacher contacts DNS/mail infrastructure (and a proxy if you configure one); it is not an offline check.

## Verification and development

```bash
python3 -m unittest discover -s tests -v
```

Tests cover result parsing, timeout/error classification, native process argument handling, request validation, and Codespaces host/origin handling. They mock the SMTP engine; actual network availability must be checked separately. No payment services or credentials are required for the tests.

## Open-source notices and references

The wrapper source is MIT-licensed; see LICENSE. Reacher is separate software under its upstream licensing (AGPL-3.0 or a commercial license, as described upstream). This archive does not bundle its binary or source. The installer downloads it from the official repository. If you redistribute Reacher or modify/expose it as a service, follow its license, including applicable source-availability requirements.

- Reacher source and setup: https://github.com/reacherhq/check-if-email-exists
- Pinned release: https://github.com/reacherhq/check-if-email-exists/releases/tag/v0.11.7
- CLI documentation: https://github.com/reacherhq/check-if-email-exists/blob/v0.11.7/cli/README.md
- Reacher licensing: https://github.com/reacherhq/check-if-email-exists/blob/v0.11.7/LICENSE.md
- Codespaces ports: https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
