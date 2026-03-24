# Pyzzle Backend

Flask backend for managing user connections, sandboxed code execution, and teacher administration.

## Features

- Per-user connection state and execution state management
- WebSocket-based run control, input requests, and status updates
- One-minute heartbeat tracking with ten-minute idle termination
- Teacher admin page for reviewing live sessions and user submissions
- Temporary user blocking and forced interruption of running programs

## Run

1. Install dependencies from `requirements.txt`.
2. Start the server with `python src/app.py`.
3. Open the teacher dashboard at `/admin`.

## Notes

- The execution runner uses a local subprocess with timeout protection and a dedicated temporary directory.
- This is an MVP runtime for development. Stronger OS-level isolation should replace it before production use.
