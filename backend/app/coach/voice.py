"""Server-side voice: text-to-speech (cached on disk) and speech-to-text.

API keys stay on the server. If voice isn't configured or fails, the browser falls back to its
built-in speech synthesis and typed questions, so tracking and on-screen cues keep working.
"""
import hashlib
import io

from app import settings


class VoiceUnavailable(Exception):
    pass


def tts_available() -> bool:
    return settings.VOICE_ENABLED and bool(settings.VOICE_API_KEY) and not settings.OFFLINE_MODE


def stt_available() -> bool:
    return tts_available()


def _client():
    import openai
    return openai.OpenAI(api_key=settings.VOICE_API_KEY, base_url=settings.VOICE_BASE_URL)


def tts_cache_path(text: str):
    key = hashlib.sha256(f"{settings.VOICE_TTS_MODEL}|{settings.VOICE_TTS_VOICE}|{text}".encode("utf-8")).hexdigest()
    return settings.COACH_TTS_CACHE_DIR / f"{key}.mp3"


def speech_stream(text: str, cache: bool = True):
    """Iterator of MP3 chunks. Streams from the API so playback starts quickly; cue phrases are
    saved to disk on the way through (one-off answers use cache=False).
    Raises VoiceUnavailable *before* the first chunk if speech can't be produced."""
    path = tts_cache_path(text)
    if cache and path.exists():
        return iter([path.read_bytes()])
    if not tts_available():
        raise VoiceUnavailable("Server voice is off or not configured.")
    try:
        ctx = _client().audio.speech.with_streaming_response.create(
            model=settings.VOICE_TTS_MODEL, voice=settings.VOICE_TTS_VOICE, input=text, response_format="mp3",
            instructions="Friendly, energetic football coach. Short and clear.",
        )
        response = ctx.__enter__()   # HTTP errors surface here, before we start answering
    except Exception as exc:
        raise VoiceUnavailable(f"Text-to-speech failed ({type(exc).__name__}).") from exc

    def chunks():
        received = []
        try:
            for chunk in response.iter_bytes(8192):
                received.append(chunk)
                yield chunk
            if cache:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"".join(received))
        finally:
            ctx.__exit__(None, None, None)
    return chunks()


def speak(text: str, cache: bool = True) -> bytes:
    """Whole MP3 at once (used by tests and scripts)."""
    return b"".join(speech_stream(text, cache))


def transcribe(audio: bytes, filename: str, content_type: str) -> str:
    """Transcribe a short spoken question. The audio is not stored."""
    if not stt_available():
        raise VoiceUnavailable("Speech-to-text is off or not configured. Type your question instead.")
    try:
        result = _client().audio.transcriptions.create(
            model=settings.VOICE_STT_MODEL, file=(filename, io.BytesIO(audio), content_type),
            prompt="A football player asking their coach about shooting or dribbling technique.",
        )
    except Exception as exc:
        raise VoiceUnavailable(f"Speech-to-text failed ({type(exc).__name__}).") from exc
    return (result.text or "").strip()
