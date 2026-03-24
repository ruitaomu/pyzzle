from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .sandbox import SandboxRunner


ConnectionState = Literal['connected', 'reconnecting', 'terminated', 'blocked']
ExecutionState = Literal['idle', 'running', 'waiting_input', 'finished', 'failed', 'interrupted']


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class CodeSubmission:
    submission_id: str
    code: str
    submitter_name: str | None = None
    created_at: datetime = field(default_factory=utc_now)
    outcome: str = 'pending'
    finished_at: datetime | None = None
    run_session_id: str | None = None

    def to_dict(self) -> dict:
        return {
            'submissionId': self.submission_id,
            'code': self.code,
            'submitterName': self.submitter_name,
            'createdAt': self.created_at.isoformat(),
            'outcome': self.outcome,
            'finishedAt': self.finished_at.isoformat() if self.finished_at else None,
            'runSessionId': self.run_session_id,
        }


@dataclass(slots=True)
class ActiveRun:
    run_session_id: str
    submission_id: str
    prompt_id: str | None = None
    runner: SandboxRunner | None = None


@dataclass(slots=True)
class UserSession:
    user_id: str
    display_name: str | None = None
    connection_state: ConnectionState = 'terminated'
    execution_state: ExecutionState = 'idle'
    blocked: bool = False
    connected_sid: str | None = None
    last_seen_at: datetime = field(default_factory=utc_now)
    active_run: ActiveRun | None = None
    pending_prompt_text: str | None = None
    submissions: list[CodeSubmission] = field(default_factory=list)

    def touch(self) -> None:
        self.last_seen_at = utc_now()

    def latest_submission(self) -> CodeSubmission | None:
        if not self.submissions:
            return None
        return self.submissions[-1]

    def to_snapshot(self) -> dict:
        latest = self.latest_submission()
        return {
            'userId': self.user_id,
            'displayName': self.display_name,
            'connectionState': self.connection_state,
            'executionState': self.execution_state,
            'blocked': self.blocked,
            'lastSeenAt': self.last_seen_at.isoformat(),
            'runSessionId': self.active_run.run_session_id if self.active_run else None,
            'pendingPromptId': self.active_run.prompt_id if self.active_run else None,
            'pendingPromptText': self.pending_prompt_text,
            'latestSubmission': latest.to_dict() if latest else None,
            'submissionCount': len(self.submissions),
        }

    def to_admin_dict(self) -> dict:
        data = self.to_snapshot()
        data['submissions'] = [submission.to_dict() for submission in reversed(self.submissions)]
        return data
