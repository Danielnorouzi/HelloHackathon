"""The AI side of the coach: natural spoken answers grounded in the measured observations.

The model only sees a compact text summary of measurements (never frames), is told to use only
those numbers, and its reply passes a filter that drops sentences quoting speeds or distances,
which the app never measures. Without an LLM, a deterministic answer is built from the same data.
"""
import re

from app import llm, settings
from app.coach import rules as coach_rules
from app.coach.summary import NOT_MEASURED, fmt_value
from app.text import plain_dashes

SYSTEM_PROMPT = """You are a friendly football (soccer) skills coach talking out loud to a player during practice.
You receive CONTEXT: what the camera tracking actually measured in this session, with confidence levels.

Rules:
1. Only use numbers and observations that appear in CONTEXT. Never invent measurements.
2. If something was not measured or was withheld (low confidence, ball not visible, camera angle), say so
   plainly and suggest how to set up the camera so it can be measured.
3. Never state shot power, ball speed, distance in metres, or shooting accuracy. They are not measured.
4. Measurements are in "leg lengths" (hip to ankle) and degrees. Say them that way if you mention them.
5. General technique advice is fine when the player asks, but keep it clearly separate from what was measured.
6. You are speaking, not writing: at most 3 short sentences, no lists, no markdown, no emojis, no dashes.
7. No medical advice. If the player mentions pain or injury, tell them to stop and see a professional."""

NARRATIVE_PROMPT = """You are a football skills coach. Write a 2-3 sentence spoken wrap-up of a practice session
using ONLY the SUMMARY provided. Mention one strength and the most important correction if present, and
mention a tracking limitation only if it matters. No numbers that aren't in the summary. No speeds, power
or accuracy. No lists or markdown."""

# Units the app never measures; any sentence quoting them is removed from AI replies.
UNMEASURED = re.compile(r"\b\d+(\.\d+)?\s*(km/?h|kph|mph|m/s|metres?|meters?|feet|ft|yards?|%\s*accura|percent accura)",
                        re.IGNORECASE)


def filter_unmeasured(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [s for s in sentences if not UNMEASURED.search(s)]
    return " ".join(kept).strip()


def describe_measure(key: str, m: dict | None, d: dict, tracking: dict) -> str:
    if m is None:
        return f"{d['label']}: not measured"
    if coach_rules.usable(m, d["unit"]):
        return f"{d['label']}: {fmt_value(m['value'], d)} (confidence {m.get('conf', 0):.0%})"
    reason = tracking["labels"].get(m.get("reason") or "low_confidence", "low confidence")
    return f"{d['label']}: withheld ({reason.lower()})"


def build_context(skill: str, attempts: list[dict], summary: dict | None = None) -> str:
    cfg = coach_rules.skill_rules(skill)
    tracking = coach_rules.rules()["tracking"]
    defs = cfg["measurements"]
    lines = [f"Skill: {cfg['label']}. Attempts detected so far: {len(attempts)}."]
    if attempts:
        last = attempts[-1]
        lines.append("Latest attempt:")
        lines += ["- " + describe_measure(k, last.get("measurements", {}).get(k), d, tracking) for k, d in defs.items()]
        ev = coach_rules.evaluate(skill, last.get("measurements", {}))
        if ev["corrections"]:
            lines.append("Rule-based correction for the latest attempt: " + ev["corrections"][0]["text"])
    if summary:
        if summary["strengths"]:
            lines.append("Session strengths: " + " ".join(s["text"] for s in summary["strengths"]))
        if summary["corrections"]:
            lines.append("Recurring corrections: " + " ".join(f"{c['text']} {c['evidence']}" for c in summary["corrections"]))
        lines.append("Tracking limitations: " + " ".join(summary["limitations"]))
    else:
        lines.append(NOT_MEASURED[skill])
    return "\n".join(lines)


def fallback_answer(skill: str, attempts: list[dict], summary: dict | None) -> str:
    """Used when no AI model is available: repeat what was measured, nothing more."""
    if not attempts:
        return "The AI coach isn't available right now, and I haven't seen a complete attempt yet. Check the setup tips and have a go."
    ev = coach_rules.evaluate(skill, attempts[-1].get("measurements", {}))
    if ev["corrections"]:
        return f"The AI coach isn't available right now. From your last attempt: {ev['corrections'][0]['text']}"
    if ev["good"]:
        label = coach_rules.skill_rules(skill)["measurements"][ev["good"][0]]["label"].lower()
        return f"The AI coach isn't available right now. Your last attempt looked good. {label.capitalize()} was in the target range."
    return "The AI coach isn't available right now, and tracking wasn't clear enough on your last attempt to say more."


def answer(question: str, skill: str, attempts: list[dict], summary: dict | None) -> dict:
    context = build_context(skill, attempts, summary)
    try:
        raw = llm.complete_text(SYSTEM_PROMPT, f"CONTEXT:\n{context}\n\nPLAYER'S QUESTION: {question}",
                                model=settings.COACH_LLM_MODEL)
        text = plain_dashes(filter_unmeasured(raw)) or fallback_answer(skill, attempts, summary)
        return {"answer": text, "source": "ai"}
    except llm.LlmError:
        return {"answer": fallback_answer(skill, attempts, summary), "source": "rules"}


def narrative(summary: dict) -> str | None:
    import json
    try:
        raw = llm.complete_text(NARRATIVE_PROMPT, "SUMMARY:\n" + json.dumps(summary, ensure_ascii=False),
                                model=settings.COACH_LLM_MODEL)
    except llm.LlmError:
        return None
    return plain_dashes(filter_unmeasured(raw)) or None
