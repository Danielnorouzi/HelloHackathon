"""Live Skills Coach: real-time shooting / dribbling coaching from the camera.

Everything to do with live coaching lives in this package and in its own SQLite file
(settings.COACH_DATABASE_PATH), so it never touches the player-analysis data or caches.
Computer vision runs in the browser; the server only ever receives measurements (numbers),
never video frames.
"""
