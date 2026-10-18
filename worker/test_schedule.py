import json
import unittest
from datetime import datetime, timedelta, timezone

from schedule import finish_sweep, select_sweep


class DailySweepTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 16, 9, tzinfo=timezone(timedelta(hours=-4)))

    def test_daily_reels_are_due_even_after_todays_profile_only_read(self):
        state = {"last_light_completed_date": "2026-10-16"}
        self.assertEqual(select_sweep("daily", self.now, state), "full")

    def test_completion_survives_restart_but_next_day_is_due(self):
        state = {}
        select_sweep("daily", self.now, state)
        finish_sweep("daily", "full", self.now, state, True)
        restored = json.loads(json.dumps(state))
        self.assertIsNone(select_sweep("daily", self.now + timedelta(hours=4), restored))
        self.assertEqual(select_sweep("daily", self.now + timedelta(days=1), restored), "full")

    def test_failed_pass_is_not_hammered_again_by_the_hourly_poll(self):
        state = {}
        select_sweep("daily", self.now, state)
        finish_sweep("daily", "full", self.now, state, False)
        self.assertIsNone(select_sweep("daily", self.now + timedelta(hours=1), state))
        self.assertEqual(select_sweep("daily", self.now + timedelta(days=1), state), "full")

    def test_cross_midnight_completion_does_not_spend_the_next_days_slot(self):
        started = self.now.replace(hour=23)
        state = {}
        select_sweep("daily", started, state)
        finished = started + timedelta(hours=6)
        finish_sweep("daily", "full", finished, state, True)
        self.assertEqual(state["last_content_completed_date"], "2026-10-16")
        self.assertEqual(select_sweep("daily", finished, state), "full")

    def test_legacy_weekly_mode_remains_weekly(self):
        state = {}
        self.assertEqual(select_sweep("full", self.now, state), "full")
        finish_sweep("full", "full", self.now, state, True)
        self.assertIsNone(select_sweep("full", self.now, state))
        self.assertEqual(select_sweep("full", self.now + timedelta(days=1), state), "light")


if __name__ == "__main__":
    unittest.main()
