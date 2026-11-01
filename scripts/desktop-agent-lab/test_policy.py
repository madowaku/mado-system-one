"""MSO-DM-M0.8 deterministic action-policy tests. No desktop interaction."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "desktop-agent-lab" / "policy-cases.json"

OBSERVE = frozenset({"version", "status", "list-apps", "snapshot", "find", "is"})
LIMITED_ACTIONS = frozenset({"click", "type", "press", "set-value"})
PROTECTED = frozenset({"shell", "clipboard-get", "clipboard-set", "screenshot", "trace",
                       "delete", "install", "deploy", "browser-login", "network-send"})

def decide(mode, action, target, human_approved=False, verified_window=False):
    """Fail closed: this is a proposed harness policy, NOT CLI sandbox enforcement."""
    if mode not in ("SHADOW", "ACTIVE_LIMITED"):
        return "deny"
    if action in PROTECTED or target != "Notepad":
        return "deny"
    if action in OBSERVE:
        return "allow"
    if mode == "ACTIVE_LIMITED" and action in LIMITED_ACTIONS:
        if human_approved and verified_window:
            return "allow"
        return "confirm"
    return "deny"

class TestPolicy(unittest.TestCase):
    def test_shadow_fixture(self):
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(data["mode"], "SHADOW")
        for case in data["cases"]:
            with self.subTest(case=case["id"]):
                self.assertEqual(decide("SHADOW", case["action"], case["target"]),
                                 case["expected"])

    def test_active_requires_both_guards(self):
        self.assertEqual(decide("ACTIVE_LIMITED", "click", "Notepad"), "confirm")
        self.assertEqual(decide("ACTIVE_LIMITED", "click", "Notepad", True), "confirm")
        self.assertEqual(decide("ACTIVE_LIMITED", "click", "Notepad", False, True), "confirm")
        self.assertEqual(decide("ACTIVE_LIMITED", "click", "Notepad", True, True), "allow")

    def test_high_risk_always_denied(self):
        for action in PROTECTED:
            with self.subTest(action=action):
                self.assertEqual(decide("ACTIVE_LIMITED", action, "Notepad", True, True), "deny")

    def test_unknown_or_off_denied(self):
        self.assertEqual(decide("OFF", "snapshot", "Notepad"), "deny")
        self.assertEqual(decide("ACTIVE", "click", "Notepad", True, True), "deny")
        self.assertEqual(decide("ACTIVE_LIMITED", "click", "Godot", True, True), "deny")
        self.assertEqual(decide("SHADOW", "click", "Notepad", True, True), "deny")

if __name__ == "__main__":
    unittest.main()
