import json
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class EngineTests(unittest.TestCase):
    def test_parse_tracing_and_pretty_json(self):
        expected = {'is_reachable': 'unknown', 'smtp': {'error': 'blocked'}}
        self.assertEqual(app.parse_result('trace {}\n' + json.dumps(expected)), expected)

    def test_no_result_is_an_error(self):
        with self.assertRaises(ValueError):
            app.parse_result('{"error":"failed"}')

    def test_timeout_is_unknown_not_invalid(self):
        with patch('app.subprocess.run', side_effect=subprocess.TimeoutExpired('reacher', 60)):
            result = app.check('example@example.com')
        self.assertEqual(result['status'], 'unknown')
        self.assertIsNone(result['details'])

    def test_nonzero_exit_is_not_an_email_verdict(self):
        with patch('app.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'panic')):
            with self.assertRaises(RuntimeError):
                app.check('example@example.com')

    def test_argument_injection_prevented(self):
        email = '--help@example.com'
        output = subprocess.CompletedProcess([], 0, '{"is_reachable":"risky"}', '')
        with patch('app.subprocess.run', return_value=output) as run:
            self.assertEqual(app.check(email)['status'], 'risky')
        args, kwargs = run.call_args
        self.assertEqual(args[0][-2:], ['--', email])
        self.assertFalse(kwargs['shell'])
        self.assertEqual(kwargs['env']['CHECK_GRAVATAR'], 'false')

    def test_validation(self):
        self.assertEqual(app.validate_email(' Name+tag@example.com '), 'Name+tag@example.com')
        for bad in [None, 12, 'a@b\r\nMAIL FROM:x', 'a@b c@d', 'missing-at', 'a'*255+'@b']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                app.validate_email(bad)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.make_server(0)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=headers or {})
        try:
            response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, response.read()

    def test_assets_and_no_arbitrary_files(self):
        for path in ['/', '/style.css', '/app.js']:
            self.assertEqual(self.request(path)[0], 200)
        self.assertEqual(self.request('/app.py')[0], 404)
        self.assertEqual(self.request('/../app.py')[0], 404)

    def test_dns_rebinding_host_blocked(self):
        self.assertEqual(self.request('/api/status', headers={'Host': 'attacker.example'})[0], 403)

    def test_requires_token_and_checks_origin(self):
        self.assertEqual(self.request('/api/check', {'email': 'a@b'})[0], 403)
        headers = {'X-Mailcheck-Token': app.TOKEN, 'Content-Type': 'application/json', 'Origin': 'https://attacker.example'}
        self.assertEqual(self.request('/api/check', {'email': 'a@b'}, headers)[0], 403)

    def test_success_flow_and_body_validation(self):
        status, data = self.request('/api/status')
        headers = {'X-Mailcheck-Token': json.loads(data)['token'], 'Content-Type': 'application/json'}
        self.assertEqual(status, 200)
        self.assertEqual(self.request('/api/check', {'email': 'bad'}, headers)[0], 400)
        with patch.object(app, 'BINARY', Path(__file__)), patch('app.check', return_value={'status': 'unknown', 'email': 'a@b', 'details': None}) as checker:
            status, data = self.request('/api/check', {'email': 'a@b'}, headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)['status'], 'unknown')
        checker.assert_called_once_with('a@b')

    def test_codespaces_exact_host_and_origin(self):
        with patch.dict('os.environ', {'CODESPACES': 'true', 'CODESPACE_NAME': 'my-test-space', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN': 'app.github.dev'}):
            server = app.make_server(0)
        try:
            host = f'my-test-space-{server.server_address[1]}.app.github.dev'
            self.assertIn(host, server.allowed_hosts)
            self.assertIn('https://' + host, server.allowed_origins)
            self.assertNotIn('another-space.app.github.dev', server.allowed_hosts)
        finally:
            server.server_close()


if __name__ == '__main__':
    unittest.main()
