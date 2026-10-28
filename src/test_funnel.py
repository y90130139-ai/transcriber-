"""The funnel reading's rules, without touching Instagram or the network.

Run from the repo root:
    .venv/Scripts/python -m unittest src.test_funnel -v      (Windows)
    .venv/bin/python -m unittest src.test_funnel -v          (Mac)

The rules worth protecting are the ones learned the expensive way: a Threads
badge is not a placement, an unread bio is not an empty bio, and a link that
vanished overnight has to surface while the model still remembers placing it.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from . import funnel


class LinkKindTests(unittest.TestCase):
    def test_a_threads_badge_on_the_same_handle_is_not_a_placement(self):
        # Instagram adds this by itself; the model placed nothing.
        self.assertEqual(funnel.kind("https://www.threads.com/@helwife_", "helwife_"), "badge")

    def test_a_threads_link_to_another_handle_is_a_real_link(self):
        self.assertEqual(funnel.kind("https://www.threads.com/@someoneelse", "helwife_"), "other")

    def test_known_selling_hosts_are_funnels(self):
        for url in ("link.me/cutesugarraex", "https://grabme.bio/leah", "https://linktr.ee/x"):
            with self.subTest(url=url):
                self.assertEqual(funnel.kind(url, "whoever"), "funnel")

    def test_sideways_links_are_not_funnels(self):
        for url in ("https://x.com/metaphysicstiff", "https://posh.mk/v3cpDHndjXb",
                    "https://m.youtube.com/@MagnusPierce"):
            with self.subTest(url=url):
                self.assertEqual(funnel.kind(url, "whoever"), "other")

    def test_an_unrecognised_domain_is_only_a_maybe(self):
        # A 348K bio held a press article about a jeweller on 2026-10-27.
        # Calling that a working funnel is the one mistake worth never making.
        self.assertEqual(funnel.kind("https://kieraleex.com/", "kiera_wild_"), "maybe")
        self.assertEqual(funnel.kind("https://www.complex.com/sports/a/x", "diggsandco"), "maybe")

    def test_confirming_a_domain_once_makes_it_a_funnel(self):
        self.assertEqual(
            funnel.kind("https://kieraleex.com/", "kiera_wild_", ["kieraleex.com"]), "funnel")

    def test_an_empty_link_is_nothing(self):
        self.assertEqual(funnel.kind("", "whoever"), "none")


class AssessTests(unittest.TestCase):
    def test_a_bio_funnel_is_green(self):
        # Arrange
        snapshot = {"handle": "cute_sugar_rae", "external_url": "https://link.me/cutesugarraex",
                    "has_story": False, "highlights": 1, "followers": 119000}

        # Act
        record = funnel.assess(snapshot)

        # Assert
        self.assertEqual(record["state"], funnel.GREEN)
        self.assertEqual(record["bio_funnel"], "https://link.me/cutesugarraex")

    def test_a_badge_only_bio_with_nothing_else_is_dark(self):
        # The exact shape of eleven accounts read on 2026-10-27.
        snapshot = {"handle": "helwife_",
                    "bio_links": [{"url": "https://www.threads.com/@helwife_"}],
                    "has_story": False, "highlights": 0, "followers": 79200}

        record = funnel.assess(snapshot)

        self.assertEqual(record["state"], funnel.RED)
        self.assertEqual(record["bio_kinds"], ["badge"])

    def test_no_bio_link_but_a_highlight_is_amber_not_red(self):
        # The highlight may carry the link; only an opened one can say.
        snapshot = {"handle": "janenotspooky", "external_url": None,
                    "has_story": False, "highlights": 3, "followers": 60800}

        self.assertEqual(funnel.assess(snapshot)["state"], funnel.AMBER)

    def test_an_unconfirmed_domain_in_bio_is_amber_not_green(self):
        # Arrange — Erica Diggs, 348K followers, bio link to a press article.
        snapshot = {"handle": "diggsandco",
                    "external_url": "https://www.complex.com/sports/a/bijan-robinson-jewelry",
                    "has_story": False, "highlights": 0, "followers": 348000}

        # Act
        record = funnel.assess(snapshot)

        # Assert
        self.assertEqual(record["state"], funnel.AMBER)
        self.assertIsNone(record["bio_funnel"])
        self.assertEqual(record["bio_maybe"], snapshot["external_url"])

    def test_a_confirmed_host_turns_that_same_bio_green(self):
        snapshot = {"handle": "kiera_wild_", "external_url": "https://kieraleex.com/",
                    "has_story": False, "highlights": 0, "followers": 59100}

        record = funnel.assess(snapshot, ["kieraleex.com"])

        self.assertEqual(record["state"], funnel.GREEN)

    def test_a_live_story_alone_is_amber(self):
        snapshot = {"handle": "someone", "external_url": None,
                    "has_story": True, "highlights": 0, "followers": 10}

        self.assertEqual(funnel.assess(snapshot)["state"], funnel.AMBER)

    def test_an_unread_bio_is_unknown_rather_than_empty(self):
        # The field was never in the payload. Saying "no link" would be a lie.
        snapshot = {"handle": "someone", "has_story": False, "highlights": 0}

        self.assertEqual(funnel.assess(snapshot)["state"], funnel.UNKNOWN)

    def test_both_bio_fields_are_read_without_duplicating(self):
        snapshot = {"handle": "x", "external_url": "https://link.me/a",
                    "bio_links": [{"url": "https://link.me/a"}],
                    "has_story": False, "highlights": 0}

        self.assertEqual(funnel.assess(snapshot)["bio_links"], ["https://link.me/a"])


class TransitionTests(unittest.TestCase):
    def test_losing_a_link_overnight_reports_what_was_lost(self):
        # Arrange
        before = [{"handle": "demi", "state": funnel.GREEN,
                   "bio_funnel": "https://link.me/demifergusx"}]
        after = [{"handle": "demi", "state": funnel.RED, "bio_funnel": None}]

        # Act
        events = funnel.transitions(before, after)

        # Assert
        self.assertEqual(events, [{"handle": "demi", "event": "went_dark",
                                   "from": funnel.GREEN, "to": funnel.RED,
                                   "lost": "https://link.me/demifergusx"}])

    def test_a_steady_account_produces_no_event(self):
        before = [{"handle": "demi", "state": funnel.GREEN, "bio_funnel": "x"}]
        after = [{"handle": "demi", "state": funnel.GREEN, "bio_funnel": "x"}]

        self.assertEqual(funnel.transitions(before, after), [])

    def test_coming_back_up_is_reported(self):
        before = [{"handle": "jane", "state": funnel.RED, "bio_funnel": None}]
        after = [{"handle": "jane", "state": funnel.GREEN, "bio_funnel": "https://grabme.bio/jane"}]

        events = funnel.transitions(before, after)

        self.assertEqual(events[0]["event"], "lit")
        self.assertEqual(events[0]["gained"], "https://grabme.bio/jane")

    def test_an_account_seen_for_the_first_time_is_new(self):
        events = funnel.transitions([], [{"handle": "fresh", "state": funnel.RED}])

        self.assertEqual(events[0]["event"], "new")


class DigestAndStoreTests(unittest.TestCase):
    def test_the_digest_leads_with_the_wasted_reach(self):
        records = [{"handle": "big", "state": funnel.RED, "followers": 500000},
                   {"handle": "small", "state": funnel.GREEN, "followers": 100}]

        text = funnel.digest(records)

        self.assertIn("1 lit", text)
        self.assertIn("500,000 followers with no bio link", text)
        self.assertIn("@big", text)

    def test_store_then_previous_round_trips(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            monday = [{"handle": "a", "state": funnel.GREEN}]

            funnel.store(monday, root, day="2026-10-26")
            recovered = funnel.previous(root, before_day="2026-10-27")

            self.assertEqual(recovered, monday)
            self.assertEqual(json.loads((root / "funnel" / "latest.json").read_text()), monday)

    def test_previous_ignores_today_and_returns_empty_when_there_is_no_history(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            funnel.store([{"handle": "a"}], root, day="2026-10-27")

            self.assertEqual(funnel.previous(root, before_day="2026-10-27"), [])


if __name__ == "__main__":
    unittest.main()


class AlertTests(unittest.TestCase):
    """The delivery rules. Nothing here touches Telegram."""

    def test_a_group_chat_id_is_refused(self):
        # Telegram writes groups and channels as negative ids, and posting this
        # digest into the ops group is the mistake to never make.
        from . import funnel_alerts

        self.assertIsNone(funnel_alerts.dm_only("-1004328834409"))

    def test_a_direct_message_id_is_accepted(self):
        from . import funnel_alerts

        self.assertEqual(funnel_alerts.dm_only(" 1469897182 "), "1469897182")

    def test_an_unset_chat_id_is_refused(self):
        from . import funnel_alerts

        self.assertIsNone(funnel_alerts.dm_only(""))
        self.assertIsNone(funnel_alerts.dm_only(None))

    def test_the_configured_destination_is_a_direct_message(self):
        # Guards the live secrets file against someone pasting a group id in.
        from . import funnel_alerts

        configured = funnel_alerts.chat_id()
        if configured is not None:
            self.assertFalse(str(configured).startswith("-"))

    def test_the_digest_opens_with_what_changed_overnight(self):
        from . import funnel_alerts
        records = [{"handle": "jane", "state": funnel.RED, "followers": 60800}]
        events = [{"handle": "jane", "event": "went_dark", "from": funnel.GREEN,
                   "to": funnel.RED, "lost": "grabme.bio/jane"}]

        text = funnel_alerts.compose(records, events, {}, "2026-10-28")

        self.assertIn("LOST A LINK SINCE YESTERDAY", text)
        self.assertIn("grabme.bio/jane was there, gone now", text)

    def test_a_snoozed_handle_drops_out_of_the_dark_list(self):
        from . import funnel_alerts
        records = [{"handle": "jane", "state": funnel.RED, "followers": 60800}]
        state = {"snooze": {"jane": "2026-11-04"}}

        text = funnel_alerts.compose(records, [], state, "2026-10-28")

        self.assertNotIn("@jane", text)
        self.assertIn("(1 snoozed)", text)

    def test_a_snooze_expires(self):
        from . import funnel_alerts
        state = {"snooze": {"jane": "2026-10-27"}}

        self.assertEqual(funnel_alerts.snoozed(state, "2026-10-28"), set())

    def test_only_accounts_that_lost_a_link_get_an_ask_button(self):
        from . import funnel_alerts
        records = [{"handle": "olddark", "state": funnel.RED, "followers": 500000},
                   {"handle": "jane", "state": funnel.RED, "followers": 60800}]
        events = [{"handle": "jane", "event": "went_dark", "lost": "grabme.bio/jane"}]

        markup = funnel_alerts.keyboard(records, events, {}, "20261028")
        labels = [b["text"] for row in markup["inline_keyboard"] for b in row]

        self.assertIn("📨 Ask @jane", labels)
        self.assertNotIn("📨 Ask @olddark", labels)

    def test_callback_data_fits_telegram_s_limit(self):
        from . import funnel_alerts
        events = [{"handle": "a" * 40, "event": "went_dark", "lost": "x"}]

        markup = funnel_alerts.keyboard([], events, {}, "20261028")

        for row in markup["inline_keyboard"]:
            for button in row:
                with self.subTest(button=button["text"]):
                    self.assertLessEqual(len(button["callback_data"].encode()), 64)


class LedgerTests(unittest.TestCase):
    """Which hosts survive. The answer to 'do deep links die faster'."""

    def test_a_host_that_vanishes_between_readings_is_counted_as_lost(self):
        with tempfile.TemporaryDirectory() as temp:
            # Arrange — Monday she has a link.me, Tuesday she has nothing.
            root = Path(temp)
            funnel.store([{"handle": "rae", "bio_funnel": "https://link.me/rae"}],
                         root, day="2026-10-26")
            funnel.store([{"handle": "rae", "bio_funnel": None}], root, day="2026-10-27")

            # Act
            rows = {r["host"]: r for r in funnel.ledger(root)}

            # Assert
            self.assertEqual(rows["link.me"]["placed"], 1)
            self.assertEqual(rows["link.me"]["lost"], 1)

    def test_a_host_that_stays_put_is_never_counted_lost(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for day in ("2026-10-25", "2026-10-26", "2026-10-27"):
                funnel.store([{"handle": "rae", "bio_funnel": "https://x.com/rae"}], root, day=day)

            rows = {r["host"]: r for r in funnel.ledger(root)}

            self.assertEqual(rows["x.com"]["placed"], 3)
            self.assertEqual(rows["x.com"]["lost"], 0)
            self.assertEqual(rows["x.com"]["last_seen"], "2026-10-27")

    def test_swapping_one_host_for_another_loses_only_the_old_one(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            funnel.store([{"handle": "rae", "bio_funnel": "https://grabme.bio/rae"}],
                         root, day="2026-10-26")
            funnel.store([{"handle": "rae", "bio_funnel": "https://x.com/rae"}],
                         root, day="2026-10-27")

            rows = {r["host"]: r for r in funnel.ledger(root)}

            self.assertEqual(rows["grabme.bio"]["lost"], 1)
            self.assertEqual(rows["x.com"]["lost"], 0)


class DeepReadTests(unittest.TestCase):
    """What OCR is allowed to believe it saw."""

    def test_a_known_selling_host_in_ocr_text_is_a_link(self):
        from . import funnel_deep

        text = "MY LINK IS HERE link.me/cutesugarraex tap it"

        self.assertEqual(funnel_deep.links_in(text), ["link.me/cutesugarraex"])

    def test_ocr_noise_that_is_not_a_known_host_is_ignored(self):
        # OCR reads jewellery, tattoos and bedsheets as text. Believing it is
        # how a dark account gets marked green.
        from . import funnel_deep

        self.assertEqual(funnel_deep.links_in("sweet.girl vibes.only 4.ever"), [])

    def test_a_confirmed_host_is_believed(self):
        from . import funnel_deep

        found = funnel_deep.links_in("come to kieraleex.com", ["kieraleex.com"])

        self.assertEqual(found, ["kieraleex.com"])

    def test_empty_text_finds_nothing(self):
        from . import funnel_deep

        self.assertEqual(funnel_deep.links_in(""), [])
        self.assertEqual(funnel_deep.links_in(None), [])


class SnoozeScopeTests(unittest.TestCase):
    def test_a_snoozed_account_is_quiet_under_every_heading(self):
        # Arrange - she was amber, not dark; a snooze that only hides the dark
        # list would keep naming her every morning under NEEDS ONE LOOK.
        from . import funnel_alerts
        records = [{"handle": "bella.starrrs", "state": funnel.AMBER,
                    "followers": 101, "bio_maybe": "sweetbritt.com"}]
        state = {"snooze": {"bella.starrrs": "2026-11-03"}}

        # Act
        text = funnel_alerts.compose(records, [], state, "2026-10-28")

        # Assert
        self.assertNotIn("bella.starrrs", text)
        self.assertIn("(1 snoozed)", text)
