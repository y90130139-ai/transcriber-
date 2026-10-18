"""Exercise the daily worker without browsers, credentials or network calls."""
import importlib.util
from pathlib import Path
from types import ModuleType
import unittest
from unittest.mock import Mock, patch


def load_worker():
    dependencies = {name: ModuleType(name) for name in ("ig", "r2", "alert", "ofmpro")}
    dependencies["alert"].alert = Mock()
    dependencies["alert"].report = Mock()
    dependencies["ofmpro"].WorkerStopped = type("WorkerStopped", (Exception,), {})
    for name in ("ensure_session", "fetch_medias", "open_browser"):
        setattr(dependencies["ofmpro"], name, Mock())
    dependencies["ig"].jars = Mock(return_value=[("main", Path("cookies"), Path("state"))])
    spec = importlib.util.spec_from_file_location("daily_worker_under_test", Path(__file__).with_name("main.py"))
    module = importlib.util.module_from_spec(spec)
    with patch.dict("sys.modules", dependencies):
        spec.loader.exec_module(module)
    return module


class DailyRefreshTests(unittest.TestCase):
    def setUp(self):
        self.worker = load_worker()
        self.calls = []
        self.worker.flush_ig_reports = Mock()
        self.worker.scheduled_ig_mode = Mock(return_value="full")
        self.worker.finish_ig_schedule = Mock()
        self.worker.mark_model_posts_done = Mock()
        self.worker.queue_ig_report = Mock()
        self.worker.record_ig_cooldown = Mock()
        self.reels = [{"post_id": "abc123", "handle": "alice"}]
        self.posts = [{"post_id": "abc123", "handle": "alice"}]
        self.snapshot = {"handle": "alice", "followers": 1000}

        def post(path, body):
            self.calls.append((path, body))
            if path == "/api/scout/targets":
                return {"creators": [{"handle": "alice"}], "mine": []}
            return {"queued": 1}

        self.worker.cloud_post = Mock(side_effect=post)

    def run_pass(self):
        with patch.dict("os.environ", {"IG_SWEEP": "daily", "IG_ROSTER": "0"}):
            self.worker.ig_pass()

    def test_creator_rows_land_before_the_browser_finishes_and_are_not_resent(self):
        def sweep(handles, jar, state, record):
            self.assertEqual(handles, ["alice"])
            record(self.reels, self.posts, self.snapshot)
            self.assertEqual(self.calls[-1][1]["sightings"], self.reels)
            self.assertFalse(self.calls[-1][1]["final"])
            return self.reels, {"alice": "open"}, None

        self.worker.ig.sweep = sweep
        # A leftover manual profile refresh must not narrow the daily content pass.
        self.worker.IG_REFRESH_HANDLES = ("somebody_else",)
        self.run_pass()
        final = self.calls[-1][1]
        self.assertTrue(final["final"])
        self.assertEqual(final["kind"], "sweep")
        self.assertEqual(final["sightings"], [])
        self.assertEqual(final["posts"], [])
        self.assertEqual(final["stats"]["sightings"], 1)
        self.worker.finish_ig_schedule.assert_called_once_with("full", success=True)

    def test_failed_streaming_write_is_retried_from_the_collected_rows(self):
        post = self.worker.cloud_post.side_effect

        def fail_once(path, body):
            if path == "/api/scout/ingest" and body.get("final") is False:
                raise OSError("cloud temporarily unavailable")
            return post(path, body)

        self.worker.cloud_post.side_effect = fail_once

        def sweep(handles, jar, state, record):
            record(self.reels, self.posts, self.snapshot)
            return self.reels, {"alice": "open"}, None

        self.worker.ig.sweep = sweep
        self.run_pass()
        self.assertEqual(self.calls[-1][1]["sightings"], self.reels)
        self.assertEqual(self.calls[-1][1]["posts"], self.posts)

    def test_session_stop_preserves_partial_rows_and_marks_the_pass_failed(self):
        def sweep(handles, jar, state, record):
            record(self.reels, self.posts, self.snapshot)
            return self.reels, {"alice": "open"}, "Instagram HTTP 429"

        self.worker.ig.sweep = sweep
        self.run_pass()
        streamed = [body for path, body in self.calls if path == "/api/scout/ingest" and not body["final"]]
        self.assertEqual(streamed[0]["sightings"], self.reels)
        self.worker.record_ig_cooldown.assert_called_once_with("Instagram HTTP 429")
        self.worker.finish_ig_schedule.assert_called_once_with("full", success=False)
        self.worker.mark_model_posts_done.assert_not_called()


if __name__ == "__main__":
    unittest.main()
