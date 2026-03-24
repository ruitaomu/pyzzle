from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Callable


InputRequestCallback = Callable[[str, str], None]
OutputCallback = Callable[[str, str], None]
DoneCallback = Callable[[int], None]
FailedCallback = Callable[[str], None]
InterruptedCallback = Callable[[str], None]

EVENT_PREFIX = '__PYZZLE_EVENT__:'
logger = logging.getLogger(__name__)

BOOTSTRAP_TEMPLATE = """
import builtins
from pathlib import Path
import traceback
import sys
import time

EVENT_PREFIX = {event_prefix!r}

def pyzzle_input(prompt=''):
    import json
    marker = json.dumps({{'type': 'input_request', 'prompt': str(prompt)}})
    print(f"{{EVENT_PREFIX}}{{marker}}", flush=True)
    line = sys.stdin.readline()
    if line == '':
        raise EOFError('Pyzzle input channel closed')
    return line.rstrip('\\n')

builtins.input = pyzzle_input
source = Path('student_code.py').read_text(encoding='utf-8')
namespace = {{'__name__': '__main__'}}
try:
    exec(compile(source, 'student_code.py', 'exec'), namespace)
except SystemExit:
    raise
except Exception:
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    time.sleep(1.0)
    sys.exit(1)
"""

class SandboxRunner:
    def __init__(
        self,
        code: str,
        timeout_seconds: int,
        on_output: OutputCallback,
        on_input_request: InputRequestCallback,
        on_done: DoneCallback,
        on_failed: FailedCallback,
        on_interrupted: InterruptedCallback,
    ) -> None:
        self.code = code
        self.timeout_seconds = timeout_seconds
        self.on_output = on_output
        self.on_input_request = on_input_request
        self.on_done = on_done
        self.on_failed = on_failed
        self.on_interrupted = on_interrupted
        self.process: subprocess.Popen[str] | None = None
        self.temp_dir: str | None = None
        self._stop_reason: str | None = None
        self._finished = threading.Event()
        self._lock = threading.Lock()
        self._reader_threads: list[threading.Thread] = []

    def start(self) -> None:
        logger.info(
            'sandbox.start timeout_seconds=%d code_len=%d\n-----SANDBOX CODE BEGIN-----\n%s\n-----SANDBOX CODE END-----',
            self.timeout_seconds,
            len(self.code),
            self.code,
        )
        self.temp_dir = tempfile.mkdtemp(prefix='pyzzle-run-')
        working_dir = Path(self.temp_dir)
        working_dir.joinpath('student_code.py').write_text(self.code, encoding='utf-8')
        working_dir.joinpath('bootstrap.py').write_text(
            BOOTSTRAP_TEMPLATE.format(event_prefix=EVENT_PREFIX),
            encoding='utf-8',
        )
        self.process = subprocess.Popen(
            [sys.executable, '-u', 'bootstrap.py'],
            cwd=working_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'},
        )
        stdout_thread = threading.Thread(target=self._read_stream, args=('stdout', self.process.stdout), daemon=True)
        stderr_thread = threading.Thread(target=self._read_stream, args=('stderr', self.process.stderr), daemon=True)
        self._reader_threads = [stdout_thread, stderr_thread]
        stdout_thread.start()
        stderr_thread.start()
        threading.Thread(target=self._wait_for_exit, daemon=True).start()
        threading.Thread(target=self._watch_timeout, daemon=True).start()
        logger.info('sandbox.process started pid=%s temp_dir=%s', self.process.pid if self.process else None, self.temp_dir)

    def submit_input(self, value: str) -> None:
        if not self.process or not self.process.stdin:
            raise RuntimeError('No active process to receive input.')
        if self._finished.is_set():
            raise RuntimeError('Run has already finished.')
        logger.info('sandbox.submit_input value_len=%d value=%s', len(value), value)
        self.process.stdin.write(f'{value}\n')
        self.process.stdin.flush()

    def stop(self, reason: str) -> None:
        with self._lock:
            self._stop_reason = reason
        logger.warning('sandbox.stop requested reason=%s pid=%s', reason, self.process.pid if self.process else None)
        if not self.process or self._finished.is_set():
            return
        self.process.terminate()

    def _read_stream(self, stream_name: str, stream) -> None:
        if stream is None:
            return
        try:
            for raw_line in iter(stream.readline, ''):
                line = raw_line.rstrip('\n')
                if stream_name == 'stdout' and line.startswith(EVENT_PREFIX):
                    self._handle_control_event(line[len(EVENT_PREFIX):])
                    continue
                logger.info('sandbox.stream %s: %s', stream_name, line)
                self.on_output(stream_name, line)
        except Exception as exc:
            logger.exception('sandbox.read_stream error stream=%s err=%s', stream_name, exc)
            self.on_output('stderr', f'[sandbox] stream reader error: {exc}')
        finally:
            stream.close()

    def _handle_control_event(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            self.on_output('stderr', f'Invalid control event: {payload}')
            return
        if data.get('type') != 'input_request':
            self.on_output('stderr', f'Unknown control event: {payload}')
            return
        prompt_id = f'prompt-{uuid.uuid4().hex[:8]}'
        prompt_text = str(data.get('prompt', ''))
        logger.info('sandbox.control_event input_request prompt_id=%s prompt_text=%s', prompt_id, prompt_text)
        self.on_input_request(prompt_id, prompt_text)

    def _watch_timeout(self) -> None:
        if self._finished.wait(timeout=self.timeout_seconds):
            return
        logger.warning('sandbox.timeout reached timeout_seconds=%d', self.timeout_seconds)
        self.stop('timeout')

    def _wait_for_exit(self) -> None:
        if not self.process:
            return
        return_code = self.process.wait()
        self._finished.set()
        for reader in self._reader_threads:
            reader.join()
        logger.info('sandbox.exit return_code=%s stop_reason=%s', return_code, self._stop_reason)
        try:
            if self._stop_reason is not None:
                self.on_interrupted(self._stop_reason)
            elif return_code == 0:
                self.on_done(return_code)
            else:
                self.on_failed(f'Program exited with code {return_code}.')
        finally:
            self._cleanup()

    def _cleanup(self) -> None:
        if self.process and self.process.stdin:
            self.process.stdin.close()
        if self.temp_dir:
            shutil.rmtree(self.temp_dir, ignore_errors=True)
        logger.info('sandbox.cleanup temp_dir=%s', self.temp_dir)
