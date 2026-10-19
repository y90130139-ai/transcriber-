import sys
import types
import unittest

# The browser driver only exists where the sweep actually runs (Railway, and
# the Mac's own env). These are pure functions, so a stub is enough to import
# the module and the test runs anywhere.
if "patchright" not in sys.modules:
    stub = types.ModuleType("patchright")
    api = types.ModuleType("patchright.sync_api")
    api.sync_playwright = lambda: None
    api.Page = object
    api.TimeoutError = TimeoutError
    api.Error = Exception
    stub.sync_api = api
    sys.modules["patchright"] = stub
    sys.modules["patchright.sync_api"] = api

from ig import belongs_to, to_post, to_sighting


def reel(**over):
    """A reel item the way a profile-page response carries one."""
    item = {
        "pk": "123",
        "code": "Dd4dfPnRkgb",
        "media_type": 2,
        "product_type": "clips",
        "taken_at": 1_790_000_000,
        "ig_play_count": 24_943_611,
        "caption": {"text": "whatever"},
    }
    item.update(over)
    return item


class WhoseReelIsIt(unittest.TestCase):
    """Instagram injects sponsored and suggested reels into the same responses
    a profile page makes, and the reader harvests every media item it sees. A
    Meta advert for VR glasses arrived stamped with a model's handle and sat at
    the top of her Top reels on 25 million plays."""

    def test_her_own_reel_is_hers(self):
        self.assertTrue(belongs_to(reel(user={"username": "blairbankstv"}), "blairbankstv"))

    def test_somebody_elses_reel_is_not_hers(self):
        self.assertFalse(belongs_to(reel(user={"username": "instagram"}), "blairbankstv"))

    def test_the_author_is_read_off_the_caption_too(self):
        # Several of the profile-page responses carry the author there and
        # nowhere else.
        item = reel(caption={"text": "meet Meta VR Glasses", "user": {"username": "meta"}})
        self.assertFalse(belongs_to(item, "blairbankstv"))

    def test_an_ad_marker_is_enough_on_its_own(self):
        for marker in ("ad_id", "is_ad", "injected", "ad_metadata", "sponsor_tags", "ad_action"):
            with self.subTest(marker=marker):
                self.assertFalse(belongs_to(reel(**{marker: "anything"}), "blairbankstv"))

    def test_a_collab_she_is_credited_on_is_hers(self):
        item = reel(user={"username": "someone_else"},
                    coauthor_producers=[{"username": "BlairBanksTV"}])
        self.assertTrue(belongs_to(item, "blairbankstv"))

    def test_the_comparison_ignores_case(self):
        self.assertTrue(belongs_to(reel(user={"username": "BlairBanksTV"}), "blairbankstv"))

    def test_an_item_with_no_author_is_kept(self):
        # Not every response carries one. Losing her real posts to a shape we
        # do not recognise is the worse failure of the two.
        self.assertTrue(belongs_to(reel(), "blairbankstv"))

    def test_a_malformed_author_does_not_crash_the_sweep(self):
        self.assertTrue(belongs_to(reel(user="not a dict"), "blairbankstv"))
        self.assertTrue(belongs_to(reel(user={"username": None}), "blairbankstv"))

    def test_both_readers_drop_it(self):
        ad = reel(user={"username": "instagram"})
        self.assertIsNone(to_sighting(ad, "blairbankstv"))
        self.assertIsNone(to_post(ad, "blairbankstv"))

    def test_both_readers_still_keep_hers(self):
        hers = reel(user={"username": "blairbankstv"})
        self.assertIsNotNone(to_sighting(hers, "blairbankstv"))
        kept = to_post(hers, "blairbankstv")
        self.assertIsNotNone(kept)
        self.assertEqual(kept["handle"], "blairbankstv")
        self.assertEqual(kept["kind"], "reel")

    def test_a_photo_of_hers_is_still_kept_for_cadence(self):
        photo = reel(media_type=1, product_type="feed", user={"username": "blairbankstv"})
        self.assertIsNone(to_sighting(photo, "blairbankstv"), "the library is reels")
        self.assertIsNotNone(to_post(photo, "blairbankstv"), "cadence counts carousels and stills")


if __name__ == "__main__":
    unittest.main()
