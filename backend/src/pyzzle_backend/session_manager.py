from __future__ import annotations

import logging
import threading
import uuid
from datetime import timedelta
from typing import Callable

from .models import ActiveRun, CodeSubmission, UserSession, utc_now
from .sandbox import SandboxRunner


EmitCallback = Callable[[str, str, dict], None]
DisconnectCallback = Callable[[str], None]
logger = logging.getLogger(__name__)


class SessionManager:
    def __init__(self, run_timeout_seconds: int, idle_timeout_seconds: int, max_submissions_per_user: int) -> None:
        self.run_timeout_seconds = run_timeout_seconds
        self.idle_timeout_seconds = idle_timeout_seconds
        self.max_submissions_per_user = max_submissions_per_user
        self._sessions: dict[str, UserSession] = {}
        self._lock = threading.RLock()
        self._emit: EmitCallback = lambda _user_id, _event, _payload: None
        self._disconnect: DisconnectCallback = lambda _sid: None

    def bind_notifier(self, emit: EmitCallback, disconnect: DisconnectCallback) -> None:
        self._emit = emit
        self._disconnect = disconnect

    def get_or_create(self, user_id: str) -> UserSession:
        with self._lock:
            session = self._sessions.get(user_id)
            if session is None:
                session = UserSession(user_id=user_id)
                self._sessions[user_id] = session
            return session

    def get_snapshot(self, user_id: str) -> dict:
        return self.get_or_create(user_id).to_snapshot()

    def register_connection(self, user_id: str, sid: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            session.connected_sid = sid
            session.touch()
            if session.blocked:
                session.connection_state = 'blocked'
            else:
                session.connection_state = 'connected'
            snapshot = session.to_snapshot()
        logger.info('register_connection user=%s sid=%s snapshot=%s', user_id, sid, snapshot)
        self._emit(user_id, 'status_snapshot', snapshot)
        return snapshot

    def mark_disconnected(self, sid: str) -> None:
        with self._lock:
            for session in self._sessions.values():
                if session.connected_sid != sid:
                    continue
                session.connected_sid = None
                if session.blocked:
                    session.connection_state = 'blocked'
                elif session.connection_state != 'terminated':
                    session.connection_state = 'reconnecting'
                logger.info(
                    'mark_disconnected user=%s sid=%s new_connection_state=%s',
                    session.user_id,
                    sid,
                    session.connection_state,
                )
                break

    def record_heartbeat(self, user_id: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            session.touch()
            snapshot = session.to_snapshot()
        logger.info(
            'record_heartbeat user=%s connection=%s execution=%s',
            user_id,
            snapshot.get('connectionState'),
            snapshot.get('executionState'),
        )
        self._emit(user_id, 'status_snapshot', snapshot)
        return snapshot

    def request_reconnect(self, user_id: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            session.touch()
            if session.blocked:
                session.connection_state = 'blocked'
            elif session.connected_sid:
                session.connection_state = 'connected'
            else:
                session.connection_state = 'reconnecting'
            snapshot = session.to_snapshot()
        logger.info('request_reconnect user=%s snapshot=%s', user_id, snapshot)
        return snapshot

    def start_run(self, user_id: str, code: str, username: str | None = None) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            if session.blocked:
                raise ValueError('This user is blocked by the teacher.')
            if session.connection_state != 'connected':
                raise ValueError('The user is not connected to the backend.')
            if session.execution_state not in ('idle', 'finished', 'failed', 'interrupted'):
                raise ValueError('A program is already active for this user.')

            normalized_name = (username or '').strip() or None
            if normalized_name:
                session.display_name = normalized_name

            submission = CodeSubmission(
                submission_id=f'sub-{uuid.uuid4().hex[:8]}',
                code=code,
                submitter_name=session.display_name,
            )
            submission.run_session_id = f'run-{uuid.uuid4().hex[:8]}'
            session.submissions.append(submission)
            session.submissions = session.submissions[-self.max_submissions_per_user :]
            session.active_run = ActiveRun(
                run_session_id=submission.run_session_id,
                submission_id=submission.submission_id,
            )
            session.execution_state = 'running'
            session.pending_prompt_text = None
            session.touch()

            runner = SandboxRunner(
                code=code,
                timeout_seconds=self.run_timeout_seconds,
                on_output=lambda stream, chunk: self._handle_output(user_id, submission.run_session_id or '', stream, chunk),
                on_input_request=lambda prompt_id, prompt_text: self._handle_input_request(
                    user_id,
                    submission.run_session_id or '',
                    prompt_id,
                    prompt_text,
                ),
                on_done=lambda exit_code: self._handle_done(user_id, submission.run_session_id or '', exit_code),
                on_failed=lambda message: self._handle_failed(user_id, submission.run_session_id or '', message),
                on_interrupted=lambda reason: self._handle_interrupted(user_id, submission.run_session_id or '', reason),
            )
            session.active_run.runner = runner
            run_session_id = submission.run_session_id
            snapshot = session.to_snapshot()
        logger.info(
            'start_run accepted user=%s username=%s run=%s submission=%s code_len=%d',
            user_id,
            session.display_name,
            run_session_id,
            submission.submission_id,
            len(code),
        )

        self._emit(user_id, 'run_ack', {'runSessionId': run_session_id})
        self._emit(user_id, 'status_snapshot', snapshot)
        runner.start()
        return snapshot

    def submit_code(self, user_id: str, code: str, username: str | None = None) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            if session.connection_state not in ('connected', 'blocked'):
                raise ValueError('The user is not connected to the backend.')

            normalized_name = (username or '').strip() or None
            if normalized_name:
                session.display_name = normalized_name

            submission = CodeSubmission(
                submission_id=f'sub-{uuid.uuid4().hex[:8]}',
                code=code,
                submitter_name=session.display_name,
                outcome='submitted',
            )
            session.submissions.append(submission)
            session.submissions = session.submissions[-self.max_submissions_per_user :]
            session.touch()
            snapshot = session.to_snapshot()

        logger.info(
            'submit_code accepted user=%s username=%s submission=%s code_len=%d',
            user_id,
            session.display_name,
            submission.submission_id,
            len(code),
        )
        self._emit(user_id, 'code_submit_ack', {'submissionId': submission.submission_id})
        self._emit(user_id, 'status_snapshot', snapshot)
        return snapshot

    def submit_input(self, user_id: str, prompt_id: str, value: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            if not session.active_run:
                raise ValueError('No active run is waiting for input.')
            if session.active_run.prompt_id != prompt_id:
                raise ValueError('Prompt ID does not match the active input request.')
            runner = session.active_run.runner
            if runner is None:
                raise ValueError('Run process is unavailable.')
            session.execution_state = 'running'
            session.pending_prompt_text = None
            session.active_run.prompt_id = None
            session.touch()
            snapshot = session.to_snapshot()
        logger.info(
            'submit_input user=%s run=%s prompt=%s value_len=%d value=%s',
            user_id,
            session.active_run.run_session_id if session.active_run else None,
            prompt_id,
            len(value),
            value,
        )

        runner.submit_input(value)
        self._emit(user_id, 'status_snapshot', snapshot)
        return snapshot

    def stop_run(self, user_id: str, actor: str, reason: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            if session.execution_state not in ('running', 'waiting_input') or not session.active_run:
                raise ValueError('There is no running program to stop.')
            runner = session.active_run.runner
            if runner is None:
                raise ValueError('Run process is unavailable.')
            session.touch()
            snapshot = session.to_snapshot()
        logger.info(
            'stop_run user=%s run=%s actor=%s reason=%s',
            user_id,
            session.active_run.run_session_id if session.active_run else None,
            actor,
            reason,
        )
        runner.stop(f'{actor}:{reason}')
        return snapshot

    def block_user(self, user_id: str) -> dict:
        runner = None
        with self._lock:
            session = self.get_or_create(user_id)
            session.blocked = True
            session.connection_state = 'blocked'
            session.touch()
            if session.active_run and session.execution_state in ('running', 'waiting_input'):
                runner = session.active_run.runner
            snapshot = session.to_snapshot()
        logger.info('block_user user=%s snapshot=%s', user_id, snapshot)

        self._emit(user_id, 'connection_blocked', {'userId': user_id})
        self._emit(user_id, 'status_snapshot', snapshot)
        if runner is not None:
            runner.stop('teacher:block')
        return snapshot

    def unblock_user(self, user_id: str) -> dict:
        with self._lock:
            session = self.get_or_create(user_id)
            session.blocked = False
            session.connection_state = 'connected' if session.connected_sid else 'reconnecting'
            session.touch()
            snapshot = session.to_snapshot()
        logger.info('unblock_user user=%s snapshot=%s', user_id, snapshot)
        self._emit(user_id, 'status_snapshot', snapshot)
        return snapshot

    def terminate_idle_sessions(self) -> list[str]:
        expired_ids: list[str] = []
        now = utc_now()
        to_stop: list[tuple[str, object | None, str | None]] = []

        with self._lock:
            for user_id, session in self._sessions.items():
                if session.connection_state == 'terminated':
                    continue
                idle_for = now - session.last_seen_at
                if idle_for <= timedelta(seconds=self.idle_timeout_seconds):
                    continue
                runner = session.active_run.runner if session.active_run else None
                sid = session.connected_sid
                session.connected_sid = None
                session.connection_state = 'terminated'
                session.pending_prompt_text = None
                if session.active_run and session.execution_state in ('running', 'waiting_input'):
                    session.execution_state = 'interrupted'
                elif session.execution_state not in ('finished', 'failed', 'interrupted'):
                    session.execution_state = 'idle'
                expired_ids.append(user_id)
                to_stop.append((user_id, runner, sid))
                logger.warning('terminate_idle user=%s idle_timeout_seconds=%d', user_id, self.idle_timeout_seconds)

        for user_id, runner, sid in to_stop:
            self._emit(user_id, 'connection_terminated', {'userId': user_id, 'reason': 'idle_timeout'})
            self._emit(user_id, 'status_snapshot', self.get_snapshot(user_id))
            if runner is not None:
                runner.stop('system:idle_timeout')
            if sid is not None:
                self._disconnect(sid)

        return expired_ids

    def list_sessions(self) -> list[dict]:
        with self._lock:
            sessions = [session.to_admin_dict() for session in self._sessions.values()]
        sessions.sort(key=lambda item: item['lastSeenAt'], reverse=True)
        return sessions

    def _handle_output(self, user_id: str, run_session_id: str, stream: str, chunk: str) -> None:
        with self._lock:
            session = self.get_or_create(user_id)
            if not session.active_run or session.active_run.run_session_id != run_session_id:
                return
            session.touch()
        logger.info('output user=%s run=%s stream=%s chunk=%s', user_id, run_session_id, stream, chunk)
        self._emit(user_id, 'output', {'runSessionId': run_session_id, 'stream': stream, 'chunk': chunk})

    def _handle_input_request(self, user_id: str, run_session_id: str, prompt_id: str, prompt_text: str) -> None:
        with self._lock:
            session = self.get_or_create(user_id)
            if not session.active_run or session.active_run.run_session_id != run_session_id:
                return
            session.execution_state = 'waiting_input'
            session.active_run.prompt_id = prompt_id
            session.pending_prompt_text = prompt_text
            session.touch()
            snapshot = session.to_snapshot()
        logger.info('input_request user=%s run=%s prompt=%s text=%s', user_id, run_session_id, prompt_id, prompt_text)
        self._emit(
            user_id,
            'input_request',
            {'runSessionId': run_session_id, 'promptId': prompt_id, 'promptText': prompt_text},
        )
        self._emit(user_id, 'status_snapshot', snapshot)

    def _handle_done(self, user_id: str, run_session_id: str, exit_code: int) -> None:
        self._finalize_run(user_id, run_session_id, 'finished', {'run_done': {'runSessionId': run_session_id, 'exitCode': exit_code}})

    def _handle_failed(self, user_id: str, run_session_id: str, message: str) -> None:
        self._finalize_run(user_id, run_session_id, 'failed', {'run_failed': {'runSessionId': run_session_id, 'message': message}})

    def _handle_interrupted(self, user_id: str, run_session_id: str, reason: str) -> None:
        self._finalize_run(
            user_id,
            run_session_id,
            'interrupted',
            {'run_interrupted': {'runSessionId': run_session_id, 'reason': reason}},
        )

    def _finalize_run(self, user_id: str, run_session_id: str, outcome: str, event_map: dict[str, dict]) -> None:
        with self._lock:
            session = self.get_or_create(user_id)
            if not session.active_run or session.active_run.run_session_id != run_session_id:
                return
            session.execution_state = outcome
            session.pending_prompt_text = None
            submission = next(
                (item for item in session.submissions if item.submission_id == session.active_run.submission_id),
                None,
            )
            if submission is not None:
                submission.outcome = outcome
                submission.finished_at = utc_now()
            session.active_run = None
            session.touch()
            snapshot = session.to_snapshot()
        logger.info('finalize_run user=%s run=%s outcome=%s snapshot=%s', user_id, run_session_id, outcome, snapshot)
        for event, payload in event_map.items():
            self._emit(user_id, event, payload)
        self._emit(user_id, 'status_snapshot', snapshot)
