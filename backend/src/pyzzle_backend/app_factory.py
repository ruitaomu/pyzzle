from __future__ import annotations

import logging
from datetime import datetime

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from .config import Config
from .session_manager import SessionManager


socketio = SocketIO(async_mode='threading', cors_allowed_origins='*')
_handlers_registered = False
_cleanup_started = False
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__, template_folder='../templates')
    app.config.from_object(Config)
    CORS(app, supports_credentials=True)
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
        )

    manager = SessionManager(
        run_timeout_seconds=app.config['RUN_TIMEOUT_SECONDS'],
        idle_timeout_seconds=app.config['SESSION_IDLE_TIMEOUT_SECONDS'],
        max_submissions_per_user=app.config['MAX_SUBMISSIONS_PER_USER'],
    )
    app.extensions['session_manager'] = manager

    socketio.init_app(app, cors_allowed_origins=app.config['CORS_ORIGINS'])
    manager.bind_notifier(
        emit=lambda user_id, event, payload: _emit_to_user(manager, user_id, event, payload),
        disconnect=lambda sid: socketio.server.disconnect(sid, namespace='/ws'),
    )

    _register_http_routes(app, manager)
    _register_socket_handlers(manager)
    _start_cleanup_loop(app, manager)
    app.logger.info('Pyzzle backend started. socket namespace=/ws')
    return app


def _emit_to_user(manager: SessionManager, user_id: str, event: str, payload: dict) -> None:
    session = manager.get_or_create(user_id)
    if not session.connected_sid:
        logger.debug('Skip emit event=%s user=%s: no connected sid', event, user_id)
        return
    logger.debug('Emit event=%s user=%s sid=%s payload=%s', event, user_id, session.connected_sid, payload)
    socketio.emit(event, payload, room=session.connected_sid, namespace='/ws')


def _register_http_routes(app: Flask, manager: SessionManager) -> None:
    @app.get('/health')
    def health() -> tuple[dict, int]:
        return {'ok': True}, 200

    @app.get('/api/session/status')
    def get_status():
        user_id = request.args.get('user_id', '').strip()
        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400
        logger.info('HTTP status user=%s', user_id)
        return jsonify(manager.get_snapshot(user_id))

    @app.post('/api/session/heartbeat')
    def post_heartbeat():
        payload = request.get_json(silent=True) or {}
        user_id = str(payload.get('userId', '')).strip()
        if not user_id:
            return jsonify({'error': 'userId is required'}), 400
        snapshot = manager.record_heartbeat(user_id)
        logger.info(
            'HTTP heartbeat user=%s connection=%s execution=%s',
            user_id,
            snapshot.get('connectionState'),
            snapshot.get('executionState'),
        )
        return jsonify(snapshot)

    @app.post('/api/session/reconnect')
    def reconnect():
        payload = request.get_json(silent=True) or {}
        user_id = str(payload.get('userId', '')).strip()
        if not user_id:
            return jsonify({'error': 'userId is required'}), 400
        snapshot = manager.request_reconnect(user_id)
        logger.info(
            'HTTP reconnect user=%s connection=%s execution=%s',
            user_id,
            snapshot.get('connectionState'),
            snapshot.get('executionState'),
        )
        return jsonify(snapshot)

    @app.get('/admin')
    def admin_dashboard():
        return render_template('admin.html')

    @app.get('/api/admin/sessions')
    def admin_sessions():
        return jsonify({'sessions': manager.list_sessions()})

    @app.post('/api/admin/users/<user_id>/stop')
    def admin_stop_user(user_id: str):
        try:
            snapshot = manager.stop_run(user_id, actor='teacher', reason='teacher_stop')
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        return jsonify(snapshot)

    @app.post('/api/admin/users/<user_id>/block')
    def admin_block_user(user_id: str):
        return jsonify(manager.block_user(user_id))

    @app.post('/api/admin/users/<user_id>/unblock')
    def admin_unblock_user(user_id: str):
        return jsonify(manager.unblock_user(user_id))


def _register_socket_handlers(manager: SessionManager) -> None:
    global _handlers_registered
    if _handlers_registered:
        return

    @socketio.on('connect', namespace='/ws')
    def handle_connect(auth=None):
        auth = auth or {}
        user_id = str(auth.get('userId') or request.args.get('userId') or '').strip()
        if not user_id:
            logger.warning('WS connect rejected sid=%s: missing userId', request.sid)
            return False
        snapshot = manager.register_connection(user_id, request.sid)
        logger.info('WS connect sid=%s user=%s snapshot=%s', request.sid, user_id, snapshot)
        emit('connect_ack', {'userId': user_id})
        if snapshot['connectionState'] == 'blocked':
            emit('connection_blocked', {'userId': user_id})

    @socketio.on('disconnect', namespace='/ws')
    def handle_disconnect():
        logger.info('WS disconnect sid=%s', request.sid)
        manager.mark_disconnected(request.sid)

    @socketio.on('heartbeat', namespace='/ws')
    def handle_heartbeat(payload=None):
        payload = payload or {}
        user_id = str(payload.get('userId', '')).strip()
        if not user_id:
            logger.warning('WS heartbeat ignored sid=%s: missing userId payload=%s', request.sid, payload)
            return
        snapshot = manager.record_heartbeat(user_id)
        logger.info(
            'WS heartbeat sid=%s user=%s connection=%s execution=%s',
            request.sid,
            user_id,
            snapshot.get('connectionState'),
            snapshot.get('executionState'),
        )
        emit(
            'heartbeat_ack',
            {
                'userId': user_id,
                'serverTime': datetime.utcnow().isoformat() + 'Z',
                'connectionState': snapshot.get('connectionState'),
                'executionState': snapshot.get('executionState'),
            },
        )

    @socketio.on('run_start', namespace='/ws')
    def handle_run_start(payload=None):
        payload = payload or {}
        user_id = str(payload.get('userId', '')).strip()
        username = str(payload.get('username', '')).strip()
        code = str(payload.get('code', ''))
        logger.info(
            'WS run_start sid=%s user=%s username=%s code_len=%d\n-----CODE BEGIN-----\n%s\n-----CODE END-----',
            request.sid,
            user_id,
            username,
            len(code),
            code,
        )
        try:
            manager.start_run(user_id, code, username=username)
        except ValueError as exc:
            logger.warning('WS run_start rejected user=%s: %s', user_id, exc)
            emit('run_failed', {'runSessionId': None, 'message': str(exc)})

    @socketio.on('code_submit', namespace='/ws')
    def handle_code_submit(payload=None):
        payload = payload or {}
        user_id = str(payload.get('userId', '')).strip()
        username = str(payload.get('username', '')).strip()
        code = str(payload.get('code', ''))
        logger.info(
            'WS code_submit sid=%s user=%s username=%s code_len=%d',
            request.sid,
            user_id,
            username,
            len(code),
        )
        try:
            manager.submit_code(user_id, code, username=username)
        except ValueError as exc:
            logger.warning('WS code_submit rejected user=%s: %s', user_id, exc)
            emit('run_failed', {'runSessionId': None, 'message': str(exc)})

    @socketio.on('run_stop', namespace='/ws')
    def handle_run_stop(payload=None):
        payload = payload or {}
        user_id = str(payload.get('userId', '')).strip()
        logger.info('WS run_stop sid=%s user=%s payload=%s', request.sid, user_id, payload)
        try:
            manager.stop_run(user_id, actor='user', reason='user_stop')
        except ValueError as exc:
            logger.warning('WS run_stop rejected user=%s: %s', user_id, exc)
            emit('run_failed', {'runSessionId': None, 'message': str(exc)})

    @socketio.on('input_submit', namespace='/ws')
    def handle_input_submit(payload=None):
        payload = payload or {}
        user_id = str(payload.get('userId', '')).strip()
        prompt_id = str(payload.get('promptId', '')).strip()
        value = str(payload.get('value', ''))
        logger.info(
            'WS input_submit sid=%s user=%s prompt=%s value_len=%d value=%s',
            request.sid,
            user_id,
            prompt_id,
            len(value),
            value,
        )
        try:
            manager.submit_input(user_id, prompt_id, value)
        except ValueError as exc:
            logger.warning('WS input_submit rejected user=%s prompt=%s: %s', user_id, prompt_id, exc)
            emit('run_failed', {'runSessionId': None, 'message': str(exc)})

    _handlers_registered = True


def _start_cleanup_loop(app: Flask, manager: SessionManager) -> None:
    global _cleanup_started
    if _cleanup_started:
        return

    def cleanup_loop() -> None:
        while True:
            socketio.sleep(app.config['CLEANUP_INTERVAL_SECONDS'])
            manager.terminate_idle_sessions()

    socketio.start_background_task(cleanup_loop)
    _cleanup_started = True
