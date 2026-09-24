#!/usr/bin/env python3
"""Run local services in separate process groups and always reap them on exit."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {
    'backend': (8000, [str(ROOT / 'venv/bin/python'), 'backend/main.py'], ROOT),
    # --host also listens on the LAN: a phone on the same Wi-Fi opens the "Network" URL Vite prints,
    # while localhost keeps working. /api is proxied to :8000 on this machine, so the backend needs no change.
    'frontend': (5173, ['npm', 'run', 'dev', '--', '--port', '5173', '--strictPort', '--host'], ROOT / 'frontend'),
}


def output(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or f'Failed: {args[0]}')
    return result.stdout


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def send(pid, sig, group=False):
    try:
        (os.killpg if group else os.kill)(pid, sig)
    except ProcessLookupError:
        pass
    except PermissionError:
        if not group or group_alive(pid):
            raise


def clean(names):
    # Inspect every port before stopping anything. Never kill by port alone.
    listeners = set()
    for name in names:
        port = SERVICES[name][0]
        for value in output(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t']).split():
            pid = int(value)
            cwd = output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'])
            paths = [Path(line[1:]).resolve() for line in cwd.splitlines() if line.startswith('n')]
            if not paths or not all(p == ROOT or ROOT in p.parents for p in paths):
                raise RuntimeError(f'Port {port} is occupied by another or unverified process ({pid}); left untouched.')
            listeners.add(pid)
    if not listeners:
        return
    # Include descendants (for example Vite's esbuild worker).
    rows = output(['ps', '-axo', 'pid=,ppid=']).splitlines()
    parents = {int(row.split()[0]): int(row.split()[1]) for row in rows}
    targets = set(listeners)
    while True:
        expanded = targets | {pid for pid, parent in parents.items() if parent in targets}
        if expanded == targets:
            break
        targets = expanded
    print('Stopping old project services...', flush=True)
    for pid in targets:
        send(pid, signal.SIGTERM)
    deadline = time.monotonic() + 3
    while any(alive(pid) for pid in targets) and time.monotonic() < deadline:
        time.sleep(0.1)
    for pid in targets:
        if alive(pid):
            send(pid, signal.SIGKILL)
    # Wait for socket release before starting replacement services.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if all(not output(['lsof', '-nP', f'-iTCP:{SERVICES[name][0]}', '-sTCP:LISTEN', '-t']).strip() for name in names):
            return
        time.sleep(0.1)
    raise RuntimeError('Ports did not become free after cleanup.')


def run(names):
    children = []

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        clean(names)
        env = os.environ.copy()
        proxy = env.get('PROXY', 'http://127.0.0.1:7890')
        env.update(http_proxy=proxy, https_proxy=proxy)
        for name in names:
            _, command, cwd = SERVICES[name]
            # Block shutdown signals across spawn + registration so no child is lost.
            mask = signal.pthread_sigmask(signal.SIG_BLOCK, set(previous))
            try:
                children.append(subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                    preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask)))
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        print('Development services started. Ctrl+C stops all services.', flush=True)
        while True:
            for child in children:
                status = child.poll()
                if status is not None:
                    print('A service exited; stopping the remaining services.', flush=True)
                    return status if status > 0 else 1
            time.sleep(0.2)
    finally:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        for child in children:
            send(child.pid, signal.SIGTERM, group=True)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            for child in children:
                child.poll()
            if not any(group_alive(child.pid) for child in children):
                break
            time.sleep(0.1)
        for child in children:
            send(child.pid, signal.SIGKILL, group=True)
            child.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # macOS can report EPERM for an already-disappeared process group.
        return str(pgid) in output(['ps', '-axo', 'pgid=']).split()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'dev'
    if mode not in ('dev', 'backend', 'frontend', 'clean'):
        raise SystemExit('Usage: dev.py [dev|backend|frontend|clean]')
    names = list(SERVICES) if mode in ('dev', 'clean') else [mode]
    try:
        if mode == 'clean':
            clean(names)
            print('Project development ports are free.')
            return 0
        return run(names)
    except (RuntimeError, OSError) as exc:
        print(f'Development error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
