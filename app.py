"""Mailcheck: local browser app for the native Reacher CLI. Python 3.10+."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
BINARY = Path(os.environ.get('REACHER_BIN', str(ROOT / 'bin' / 'check_if_email_exists'))).expanduser().resolve()
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()
TIMEOUT = 60

# Batch mode is intentionally restricted to domains the operator controls.
# Well-known public mailbox providers stay syntax-only even if they are placed
# in MAILCHECK_BATCH_ALLOWED_DOMAINS.
PUBLIC_BATCH_DOMAINS = {
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'ymail.com', 'rocketmail.com',
    'icloud.com', 'me.com', 'mac.com',
    'aol.com',
    'proton.me', 'protonmail.com',
    'gmx.com', 'gmx.net',
    'mail.com',
}
BATCH_ALLOWED_DOMAINS = {
    item.strip().lower().rstrip('.')
    for item in os.environ.get('MAILCHECK_BATCH_ALLOWED_DOMAINS', '').split(',')
    if item.strip()
}


def parse_result(output):
    """Find the result object even when Reacher writes tracing lines before JSON."""
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', output):
        try:
            value, _ = decoder.raw_decode(output[match.start():])
            if isinstance(value, dict) and 'is_reachable' in value:
                return value
        except ValueError:
            pass
    raise ValueError('Reacher returned an unreadable result.')


def validate_email(value):
    if not isinstance(value, str):
        raise ValueError('Enter an email address.')
    value = value.strip()
    if len(value) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+', value):
        raise ValueError('Enter one email address, such as name@company.com.')
    return value


def email_domain(email):
    return email.rsplit('@', 1)[1].lower().rstrip('.')


def batch_probe_allowed(email):
    domain = email_domain(email)
    return domain in BATCH_ALLOWED_DOMAINS and domain not in PUBLIC_BATCH_DOMAINS


def syntax_only_result(email, reason=None):
    domain = email_domain(email)
    if reason is None:
        if domain in PUBLIC_BATCH_DOMAINS:
            reason = (
                'Batch mailbox probing is disabled for public mailbox providers. '
                'The address format is valid, but mailbox existence was not tested.'
            )
        else:
            reason = (
                'Mailbox probing was skipped because this domain is not allow-listed for batch checks. '
                'Set MAILCHECK_BATCH_ALLOWED_DOMAINS to domains you control.'
            )
    return {
        'email': email,
        'status': 'syntax_only',
        'reason': reason,
        'details': {'syntax': {'is_valid_syntax': True}},
        'elapsed': 0,
    }


def check(email):
    env = os.environ.copy()
    env['RUST_LOG'] = 'off'
    # Do not opt into external enrichment services through inherited variables.
    env.pop('HAVEIBEENPWNED_API_KEY', None)
    env['CHECK_GRAVATAR'] = 'false'
    started = time.monotonic()
    try:
        process = subprocess.run(
            [str(BINARY), '--', email],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=TIMEOUT,
            env=env,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        return {
            'email': email,
            'status': 'unknown',
            'reason': (
                'The check timed out after 60 seconds. The mail server may be unavailable '
                'or blocking verification. Check outbound port 25.'
            ),
            'details': None,
        }
    if process.returncode != 0:
        raise RuntimeError('Reacher could not complete the check. Check the executable and network settings; see README.md.')
    data = parse_result(process.stdout)
    status = data.get('is_reachable')
    if status not in ('safe', 'risky', 'invalid', 'unknown'):
        status = 'unknown'
    reasons = {
        'safe': 'Reacher reports this address as reachable. This is an assessment, not a delivery guarantee.',
        'risky': 'Reacher found a reason for caution. Review the individual checks below.',
        'invalid': 'Reacher reports this address as invalid. Review the evidence before removing it.',
        'unknown': (
            'Reacher could not confirm this mailbox. This does not mean the address is invalid. '
            'The server may block verification, or outbound port 25 may be unavailable.'
        ),
    }
    return {
        'email': email,
        'status': status,
        'reason': reasons[status],
        'details': data,
        'elapsed': round(time.monotonic() - started, 1),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log email addresses or request contents.

    def trusted_host(self):
        return self.headers.get('Host') in self.server.allowed_hosts

    def send(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.trusted_host():
            return self.send(403, {'error': 'Local access only.'})
        if self.path == '/api/status':
            return self.send(
                200,
                {
                    'ready': BINARY.is_file() and os.access(BINARY, os.X_OK),
                    'token': TOKEN,
                    'codespaces': os.environ.get('CODESPACES') == 'true',
                    'batch_allowed_domains': sorted(BATCH_ALLOWED_DOMAINS - PUBLIC_BATCH_DOMAINS),
                },
            )
        if self.path == '/favicon.ico':
            return self.send(204, b'', 'image/x-icon')
        assets = {
            '/': ('index.html', 'text/html'),
            '/app.js': ('app.js', 'text/javascript'),
            '/style.css': ('style.css', 'text/css'),
            '/batch.css': ('batch.css', 'text/css'),
            '/favicon.svg': ('favicon.svg', 'image/svg+xml'),
        }
        if self.path not in assets:
            return self.send(404, {'error': 'Not found.'})
        name, mime = assets[self.path]
        self.send(200, (ROOT / 'static' / name).read_bytes(), mime + '; charset=utf-8')

    def _authorized_post(self):
        if not self.trusted_host():
            self.send(
                403,
                {
                    'code': 'host_rejected',
                    'error': (
                        'This app address is not recognized. '
                        'Open port 8765 through Codespaces Ports → Open in Browser.'
                    ),
                },
            )
            return False
        if not secrets.compare_digest(
            self.headers.get('X-Mailcheck-Token', '').encode(),
            TOKEN.encode(),
        ):
            self.send(
                403,
                {
                    'code': 'session_expired',
                    'error': 'The app restarted and your session expired. Refresh this page.',
                },
            )
            return False

        # Fetch Metadata is set by the browser and cannot be supplied by page JS.
        # It describes the browser-facing origin even when a port-forwarding proxy
        # rewrites Host/Origin. Never accept "same-site" as "same-origin".
        fetch_site = self.headers.get('Sec-Fetch-Site')
        origin = self.headers.get('Origin')
        if fetch_site in ('cross-site', 'same-site') or (
            fetch_site != 'same-origin'
            and origin
            and origin not in self.server.allowed_origins
        ):
            self.send(
                403,
                {
                    'code': 'origin_rejected',
                    'error': (
                        'Request origin was rejected. Open the app in its own browser tab '
                        'using Ports → Open in Browser, then refresh.'
                    ),
                },
            )
            return False
        return True

    def _read_json(self):
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.send(415, {'error': 'JSON required.'})
            return None
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096:
                raise ValueError('Request is too large or empty.')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('Invalid request.')
            return body
        except (ValueError, UnicodeDecodeError) as exc:
            self.send(400, {'error': str(exc)})
            return None

    def _run_reacher(self, email):
        if not BINARY.is_file():
            return self.send(
                503,
                {
                    'error': (
                        'Reacher is not installed. Stop the app, run python3 setup_reacher.py, '
                        'then restart it.'
                    )
                },
            )
        if not LOCK.acquire(blocking=False):
            return self.send(429, {'error': 'Another check is still running. Please wait for it to finish.'})
        try:
            self.send(200, check(email))
        except (OSError, ValueError, RuntimeError):
            self.send(
                502,
                {
                    'error': (
                        'Reacher could not run or returned an unreadable result. '
                        'Run python3 setup_reacher.py and see README.md for troubleshooting.'
                    )
                },
            )
        finally:
            LOCK.release()

    def do_POST(self):
        if not self._authorized_post():
            return
        if self.path not in ('/api/check', '/api/batch-check'):
            return self.send(404, {'error': 'Not found.'})

        body = self._read_json()
        if body is None:
            return

        if self.path == '/api/batch-check':
            raw_email = body.get('email')
            try:
                email = validate_email(raw_email)
            except ValueError as exc:
                return self.send(
                    200,
                    {
                        'email': raw_email if isinstance(raw_email, str) else '',
                        'status': 'invalid_syntax',
                        'reason': str(exc),
                        'details': {'syntax': {'is_valid_syntax': False}},
                        'elapsed': 0,
                    },
                )
            if not batch_probe_allowed(email):
                return self.send(200, syntax_only_result(email))
            return self._run_reacher(email)

        try:
            email = validate_email(body.get('email'))
        except ValueError as exc:
            return self.send(400, {'error': str(exc)})
        return self._run_reacher(email)


def make_server(port=8765):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    actual = server.server_address[1]
    server.allowed_hosts = {f'127.0.0.1:{actual}', f'localhost:{actual}'}
    server.allowed_origins = {f'http://{host}' for host in server.allowed_hosts}
    if os.environ.get('CODESPACES') == 'true':
        name = os.environ.get('CODESPACE_NAME', '')
        domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev')
        if re.fullmatch(r'[a-z0-9-]+', name) and re.fullmatch(r'[a-z0-9.-]+', domain):
            forwarded = f'{name}-{actual}.{domain}'
            server.allowed_hosts.add(forwarded)
            server.allowed_origins.add(f'https://{forwarded}')
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--open', action='store_true', help='Open the browser automatically')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError as exc:
        raise SystemExit(f'Cannot start local app: {exc}. Close another copy, or use --port 8766.')
    url = f'http://127.0.0.1:{server.server_address[1]}'
    print(
        f'Mailcheck is running at {url}\n'
        'Keep this window open. Press Ctrl+C to stop.',
        flush=True,
    )
    if not BINARY.is_file():
        print('Reacher is missing: run python3 setup_reacher.py before checking emails.', flush=True)
    if BATCH_ALLOWED_DOMAINS:
        print(
            'Batch mailbox probing enabled for: '
            + ', '.join(sorted(BATCH_ALLOWED_DOMAINS - PUBLIC_BATCH_DOMAINS)),
            flush=True,
        )
    if args.open:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
