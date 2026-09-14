"""Test direct outbound SMTP connectivity; does not send an email."""
import socket

hosts = ['gmail-smtp-in.l.google.com', 'mx1.mail.yahoo.com']
success = False
for host in hosts:
    print(f'Checking {host}:25 ...', flush=True)
    try:
        with socket.create_connection((host, 25), timeout=5) as connection:
            connection.settimeout(5)
            banner = connection.recv(512).decode('utf-8', errors='replace').strip()
            if banner.startswith('220'):
                success = True
                print('SMTP reachable; a greeting was received. No message was sent.')
            else:
                print('TCP connected, but no normal SMTP greeting was received.')
    except OSError as exc:
        print(f'Connection unavailable: {exc}')
if success:
    print('Direct SMTP works for at least one tested server. Other domains may still block verification.')
else:
    print('No SMTP greeting received. Outbound port 25 may be restricted, or the remote servers may be blocking this IP. This test cannot identify the cause conclusively.')
