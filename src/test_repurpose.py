"""The repurpose render's shape, without running ffmpeg or touching a video.

Run from the repo root:
    .venv/Scripts/python -m unittest src.test_repurpose -v      (Windows)
    .venv/bin/python -m unittest src.test_repurpose -v          (Mac)
"""
from __future__ import annotations

import unittest
from pathlib import Path

from . import repurpose


def args_for(seed: int, duration: float | None = 30.0) -> list[str]:
    return repurpose.build_render_args(Path("in.mp4"), Path("out.mp4"), seed, duration=duration)


class RecipeShapeTests(unittest.TestCase):
    def test_the_same_seed_renders_the_same_command(self):
        self.assertEqual(args_for(12345), args_for(12345))

    def test_different_seeds_differ(self):
        self.assertNotEqual(args_for(1), args_for(2))

    def test_the_mirror_and_crop_are_always_there(self):
        filters = args_for(7)[args_for(7).index("-vf") + 1]
        self.assertIn("hflip", filters)
        self.assertIn("crop=iw*", filters)
        self.assertIn("noise=alls=", filters)
        self.assertIn("eq=brightness=", filters)
        self.assertIn("hue=h=", filters)

    def test_audio_and_video_shift_by_the_same_speed(self):
        args = args_for(9)
        video = args[args.index("-vf") + 1]
        audio = args[args.index("-af") + 1]
        speed = float(video.split("setpts=PTS/")[1])
        self.assertAlmostEqual(speed, float(audio.split("atempo=")[1]), places=5)
        self.assertGreater(speed, 1.0)
        self.assertLess(speed, 1.05)

    def test_the_crop_never_exceeds_the_source(self):
        for seed in range(200):
            index = args_for(seed).index("-vf") + 1
            crop = float(args_for(seed)[index].split("crop=iw*")[1].split(":")[0])
            self.assertLess(crop, 1.0, f"seed {seed}")
            self.assertGreater(crop, 0.9, f"seed {seed}")

    def test_the_colour_drift_is_centred_on_eq_identity(self):
        """ffmpeg's eq treats 1.0 as identity for contrast and saturation.
        A value near 0 flattens the frame to grey — verified the hard way on
        a live render (2026-10-18), so it is pinned here for every seed."""
        for seed in range(300):
            filters = args_for(seed)[args_for(seed).index("-vf") + 1]
            eq = filters.split("eq=")[1].split(",")[0]
            values = dict(part.split("=") for part in eq.split(":"))
            contrast = float(values["contrast"])
            saturation = float(values["saturation"])
            brightness = float(values["brightness"])
            self.assertLess(abs(contrast - 1.0), 0.051, f"seed {seed}: contrast {contrast}")
            self.assertLess(abs(saturation - 1.0), 0.061, f"seed {seed}: saturation {saturation}")
            self.assertLess(abs(brightness), 0.021, f"seed {seed}: brightness {brightness}")

    def test_nothing_of_the_original_container_survives(self):
        args = args_for(3)
        self.assertIn("-map_metadata", args)
        self.assertEqual(args[args.index("-map_metadata") + 1], "-1")
        creation = next(a for a in args if a.startswith("creation_time=")).split("=", 1)[1]
        self.assertRegex(creation, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertIn("libx264", args)
        self.assertIn("+faststart", args)
        self.assertIn("yuv420p", args)

    def test_a_long_clip_is_trimmed_at_both_ends(self):
        args = args_for(11, duration=30.0)
        start = float(args[args.index("-ss") + 1])
        out = float(args[args.index("-t") + 1])
        self.assertGreater(start, 0.0)
        self.assertLess(start, 0.3)
        self.assertLess(out, 30.0)

    def test_a_short_clip_keeps_every_frame_it_has(self):
        args = args_for(11, duration=4.0)
        self.assertNotIn("-ss", args)
        self.assertNotIn("-t", args)


if __name__ == "__main__":
    unittest.main()
