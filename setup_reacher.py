"""Install the official Reacher v0.11.7 CLI without Docker or pip packages."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

VERSION = 'v0.11.7'
REPO = 'reacherhq/check-if-email-exists'
ROOT = Path(__file__).resolve().parent


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mailcheck-local-installer/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def install():
    system, arch = platform.system(), platform.machine().lower()
    if system == 'Windows':
        raise RuntimeError('The official release has no Windows executable. Use Start-Windows.bat with Ubuntu in WSL; see README.md.')
    if system == 'Linux' and arch in ('x86_64', 'amd64'):
        target = 'x86_64-unknown-linux-musl'
    elif system == 'Linux' and arch in ('aarch64', 'arm64'):
        target = 'aarch64-unknown-linux-gnu'
    elif system == 'Darwin' and arch in ('x86_64', 'arm64'):
        target = 'x86_64-apple-darwin'
        if arch == 'arm64':
            print('This upstream release is Intel-only on macOS; Apple Silicon requires Rosetta 2.')
    else:
        raise RuntimeError(f'No prebuilt Reacher release for {system}/{arch}. Build the CLI from source and set REACHER_BIN; see README.md.')
    destination = ROOT / 'bin' / 'check_if_email_exists'
    manifest = destination.parent / 'installed.json'
    if destination.exists() and manifest.exists():
        record = json.loads(manifest.read_text())
        if record.get('version') == VERSION and record.get('target') == target and record.get('binary_sha256') == hashlib.sha256(destination.read_bytes()).hexdigest():
            destination.chmod(0o755)
            subprocess.run([str(destination), '--version'], check=True)
            print('Reacher is already installed.')
            return
    print(f'Downloading official Reacher {VERSION} for {target}...', flush=True)
    release = json.loads(download(f'https://api.github.com/repos/{REPO}/releases/tags/{VERSION}'))
    name = f'check_if_email_exists-{target}.tar.gz'
    asset = next((a for a in release['assets'] if a['name'] == name), None)
    if not asset:
        raise RuntimeError(f'Official asset {name} was not found.')
    url = asset['browser_download_url']
    if not url.startswith(f'https://github.com/{REPO}/releases/download/{VERSION}/'):
        raise RuntimeError('Unexpected download location.')
    archive = download(url)
    digest = hashlib.sha256(archive).hexdigest()
    if (asset.get('digest') or '').startswith('sha256:') and asset['digest'][7:] != digest:
        raise RuntimeError('Download checksum mismatch. Nothing was installed.')
    # Extract only a regular binary file, never archive paths or links.
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        members = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == 'check_if_email_exists']
        if len(members) != 1:
            raise RuntimeError('Unexpected archive layout.')
        data = tar.extractfile(members[0]).read()
    destination.parent.mkdir(exist_ok=True)
    temp = destination.with_suffix('.download')
    temp.write_bytes(data)
    temp.chmod(0o755)
    try:
        subprocess.run([str(temp), '--version'], check=True, timeout=15)
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    manifest.write_text(json.dumps({'version': VERSION, 'target': target, 'source': url,
                                   'archive_sha256': digest, 'binary_sha256': hashlib.sha256(data).hexdigest()}, indent=2))
    print('Installed. Start the app with: python3 app.py --open')


if __name__ == '__main__':
    try:
        install()
    except Exception as exc:
        raise SystemExit(f'Setup failed: {exc}\nSee README.md for manual installation and troubleshooting.')
