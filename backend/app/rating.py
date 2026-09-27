"""Game-style player card: attributes, OVR and confidence, all built from percentiles.

Every number on the card can be traced back: each attribute carries the stats and percentiles
it was built from ("evidence"), and the confidence score carries the reasons behind it.
Weights and scales live in config/rating.json.
"""
import json
from functools import lru_cache

from app import criteria
from app.settings import CONFIG_DIR


@lru_cache(maxsize=1)
def config() -> dict:
    return json.loads((CONFIG_DIR / "rating.json").read_text(encoding="utf-8"))


def to_scale(percentile: float) -> int:
    """Percentile 0-100 -> card scale (40-99 by default)."""
    cfg = config()
    return round(cfg["scale_min"] + percentile / 100 * (cfg["scale_max"] - cfg["scale_min"]))


def confidence(minutes: float, tier: int, coverage: float) -> dict:
    """0-100% confidence, with the reasons shown in the UI tooltip."""
    cfg = config()["confidence"]
    cap = cfg["tier_cap"][str(tier)]
    minutes_factor = min(1.0, minutes / cfg["full_confidence_minutes"])
    score = round(cap * minutes_factor * coverage)
    reasons = [cfg["tier_reason"][str(tier)]]
    if minutes_factor < 1:
        reasons.append(f"Only {round(minutes)} minutes analysed; full confidence needs "
                       f"{cfg['full_confidence_minutes']}+.")
    else:
        reasons.append(f"{round(minutes)} minutes analysed. That's a solid sample.")
    if coverage < 1:
        reasons.append(f"{round(coverage * 100)}% of the card's stats could be computed.")
    return {"score": score, "reasons": reasons}


def build_card(stats: list[dict], position_group: str, minutes: float, tier: int, fill: bool = True) -> dict:
    """stats: rows from metrics.stat_rows (key, label, value, percentile, ...).
    fill=True fills missing criteria from medians of measured values and labels them (app/criteria.py);
    the fill script uses fill=False so medians are only ever built from measured values."""
    cfg = config()
    by_key = {s["key"]: s for s in stats}
    attributes, available, needed = {}, 0, 0

    for code, attr in cfg["attributes"].items():
        if attr.get("unavailable"):
            attributes[code] = {"label": attr["label"], "value": None, "note": attr["unavailable"], "evidence": []}
            continue
        # Tier 1 players have no possession data: fall back to the raw version of a PAdj stat.
        evidence = [by_key.get(k) or by_key.get(k.removesuffix("_padj")) for k in attr["stats"]]
        evidence = [e for e in evidence if e is not None]
        pcts = [e["percentile"] for e in evidence if e["percentile"] is not None]
        needed += len(attr["stats"])
        available += len(pcts)
        attributes[code] = {
            "label": attr["label"],
            "value": to_scale(sum(pcts) / len(pcts)) if pcts else None,
            "percentile": round(sum(pcts) / len(pcts), 1) if pcts else None,
            "note": None if pcts else "Not enough data",
            "adjusted": any(e["key"].endswith("_padj") for e in evidence),
            "evidence": evidence,
        }

    # Confidence reflects measured values only (computed before any imputation).
    coverage = available / needed if needed else 0
    card = {"attributes": attributes, "imputed": []}
    if fill:
        criteria.fill_card(card, position_group)

    weights = cfg["ovr_weights"].get(position_group)
    ovr, ovr_note = None, None
    if weights is None:
        ovr_note = "No card for goalkeepers in the MVP"
    else:
        parts = [(w, attributes[a]["value"]) for a, w in weights.items() if attributes[a]["value"] is not None]
        if parts:
            ovr = round(sum(w * v for w, v in parts) / sum(w for w, _ in parts))
        used = [a for a in card["imputed"] if a in weights]
        if used:
            ovr_note = f"Includes imputed {', '.join(used)} (median value, not measured for this player)."

    return {
        "ovr": ovr,
        "ovr_note": ovr_note,
        "ovr_weights": weights,
        "position_group": position_group,
        "attributes": attributes,
        "imputed": card["imputed"],
        "confidence": confidence(minutes, tier, coverage),
        "tier": tier,
    }
